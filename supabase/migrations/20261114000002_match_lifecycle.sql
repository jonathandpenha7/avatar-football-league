-- Match lifecycle: server-timed halves and half-time, phase transitions,
-- event corrections with reasons, and player participation.
-- Additive only: existing fixtures keep working (null columns fall back to settings).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.fixtures
  add column phase_target_sec integer check (phase_target_sec is null or phase_target_sec >= 0),
  add column added_time_sec integer not null default 0 check (added_time_sec between 0 and 3600),
  add column first_half_elapsed_sec integer check (first_half_elapsed_sec is null or first_half_elapsed_sec >= 0),
  add column second_half_elapsed_sec integer check (second_half_elapsed_sec is null or second_half_elapsed_sec >= 0),
  add column state_version integer not null default 0,
  add column submitted_at timestamptz,
  add column submitted_by uuid references public.profiles (id) on delete set null,
  add column abandoned_reason text;

alter table public.tournament_settings
  -- Null = unlimited (e.g. rolling substitutions).
  add column max_substitutions integer check (max_substitutions is null or max_substitutions between 0 and 50),
  -- Let referees and scorekeepers nominate MVP candidates.
  add column mvp_nominations_enabled boolean not null default false;

alter table public.tournaments
  add column league_confirmed_at timestamptz,
  add column league_confirmed_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Clock helpers. clock_now() is overridable in tests via app.test_now
-- (PostgREST clients cannot set arbitrary settings).
-- ---------------------------------------------------------------------------
create or replace function private.clock_now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.test_now', true), '')::timestamptz, now())
$$;

/** Configured length of a phase in seconds for this fixture's stage. */
create or replace function private.phase_seconds(p public.fixtures, p_phase text) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  s public.tournament_settings;
  v_play integer;
  v_half integer;
begin
  select * into s from public.tournament_settings where tournament_id = p.tournament_id;
  v_play := case when p.stage = 'knockout' and s.knockout_match_duration_min is not null
                 then s.knockout_match_duration_min else s.match_duration_min end;
  if v_play is null then
    raise exception 'Set the match duration in Settings before starting matches.' using errcode = 'P0001';
  end if;
  v_half := (v_play * 60) / s.periods;
  return case p_phase
    when 'first_half' then v_half
    when 'second_half' then v_half
    when 'half_time' then coalesce(case when p.stage = 'knockout' then s.knockout_half_time_min end, s.half_time_min) * 60
    when 'extra_time' then coalesce(s.extra_time_min, 5) * 60
    else null end;
end $$;

create or replace function private.running_elapsed(p public.fixtures) returns integer
language sql stable as $$
  select p.timer_elapsed_sec
       + case when p.timer_started_at is null then 0
              else greatest(0, floor(extract(epoch from (private.clock_now() - p.timer_started_at))))::integer end
$$;

create or replace function private.phase_target(p public.fixtures) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(p.phase_target_sec, private.phase_seconds(p, p.period::text))
       + case when p.period in ('first_half', 'second_half', 'extra_time') then p.added_time_sec else 0 end
$$;

/**
 * Apply automatic transitions that are due (first half -> half-time,
 * half-time clock stops at zero, second half / extra time -> full time).
 * Transition moments are the exact expiry time, not when someone noticed.
 */
create or replace function private.normalize_clock(p public.fixtures) returns public.fixtures
language plpgsql stable security definer set search_path = public as $$
declare
  v_periods integer;
  v_target integer;
  v_expiry timestamptz;
  i integer := 0;
begin
  select periods into v_periods from public.tournament_settings where tournament_id = p.tournament_id;
  while i < 4 loop
    i := i + 1;
    exit when p.status <> 'in_progress' or p.timer_started_at is null
           or p.period not in ('first_half', 'half_time', 'second_half', 'extra_time');
    v_target := private.phase_target(p);
    exit when private.running_elapsed(p) < v_target;
    v_expiry := p.timer_started_at + make_interval(secs => v_target - p.timer_elapsed_sec);
    if p.period = 'first_half' and v_periods = 2 then
      p.first_half_elapsed_sec := v_target;
      p.period := 'half_time';
      p.timer_elapsed_sec := 0;
      p.timer_started_at := v_expiry;
      p.added_time_sec := 0;
      p.phase_target_sec := private.phase_seconds(p, 'half_time');
      -- loop again: the half-time may also have run out already
    elsif p.period = 'half_time' then
      -- Half-time is over; the referee starts the second half when ready.
      p.timer_elapsed_sec := v_target;
      p.timer_started_at := null;
      exit;
    else
      if p.period = 'first_half' then p.first_half_elapsed_sec := v_target; end if;
      if p.period = 'second_half' then p.second_half_elapsed_sec := v_target; end if;
      p.timer_elapsed_sec := v_target;
      p.timer_started_at := null;
      p.status := 'completed';
      p.period := 'full_time';
      exit;
    end if;
  end loop;
  return p;
end $$;

-- ---------------------------------------------------------------------------
-- The single entry point for every clock and phase change.
-- p_expected_version guards against two devices acting on stale state.
-- ---------------------------------------------------------------------------
create or replace function public.match_control(
  p_fixture uuid,
  p_command text,
  p_expected_version integer default null,
  p_minutes integer default null,
  p_reason text default null
) returns public.fixtures
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  b public.fixtures;
  v_periods integer;
  v_extra boolean;
  v_now timestamptz := private.clock_now();
  v_prev text;
  v_admin boolean;
  v_events integer;
begin
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  if not private.can_score_fixture(f.id) then
    raise exception 'You are not assigned to this match.' using errcode = '42501';
  end if;
  v_admin := private.is_admin(f.tournament_id);
  if f.status = 'confirmed' and p_command <> 'sync' then
    raise exception 'This result is confirmed. Use "Correct result" to reopen it first.' using errcode = 'P0001';
  end if;
  if p_command <> 'sync' and p_expected_version is not null and p_expected_version <> f.state_version then
    raise exception 'This match was just updated on another device. The screen has refreshed, please check and try again.'
      using errcode = 'P0001', hint = 'stale';
  end if;
  select periods, extra_time_enabled into v_periods, v_extra from public.tournament_settings where tournament_id = f.tournament_id;

  b := f;
  f := private.normalize_clock(f);

  case p_command
    when 'sync' then
      null;
    when 'start' then
      if f.status <> 'scheduled' then raise exception 'This match has already started.'; end if;
      if f.home_team_id is null or f.away_team_id is null then raise exception 'Both teams must be known before kick-off.'; end if;
      f.status := 'in_progress'; f.period := 'first_half';
      f.timer_started_at := v_now; f.timer_elapsed_sec := 0; f.added_time_sec := 0;
      f.phase_target_sec := private.phase_seconds(f, 'first_half');
      f.first_half_elapsed_sec := null; f.second_half_elapsed_sec := null;
    when 'pause' then
      if f.status <> 'in_progress' or f.timer_started_at is null then raise exception 'The clock is not running.'; end if;
      f.timer_elapsed_sec := private.running_elapsed(f); f.timer_started_at := null; f.status := 'paused';
    when 'resume' then
      if f.status <> 'paused' then raise exception 'The match is not paused.'; end if;
      if f.period = 'penalties' then raise exception 'There is no clock during a penalty shootout.'; end if;
      f.timer_started_at := v_now; f.status := 'in_progress';
    when 'add_time' then
      if f.period not in ('first_half', 'second_half', 'extra_time') or f.status not in ('in_progress', 'paused') then
        raise exception 'Added time can only be given during play.';
      end if;
      if coalesce(p_minutes, 0) not between 1 and 10 then raise exception 'Add between 1 and 10 minutes.'; end if;
      f.added_time_sec := f.added_time_sec + p_minutes * 60;
    when 'end_first_half' then
      if f.period <> 'first_half' or f.status not in ('in_progress', 'paused') then raise exception 'The first half is not in progress.'; end if;
      if v_periods <> 2 then raise exception 'This tournament plays one period. Use End match.'; end if;
      f.first_half_elapsed_sec := private.running_elapsed(f);
      f.period := 'half_time'; f.status := 'in_progress';
      f.timer_started_at := v_now; f.timer_elapsed_sec := 0; f.added_time_sec := 0;
      f.phase_target_sec := private.phase_seconds(f, 'half_time');
    when 'start_second_half' then
      if f.period <> 'half_time' then raise exception 'Start the second half from half-time.'; end if;
      f.period := 'second_half'; f.status := 'in_progress';
      f.timer_started_at := v_now; f.timer_elapsed_sec := 0; f.added_time_sec := 0;
      f.phase_target_sec := private.phase_seconds(f, 'second_half');
    when 'end_match' then
      if f.status not in ('in_progress', 'paused') then raise exception 'The match is not in progress.'; end if;
      if f.period = 'half_time' or (f.period = 'first_half' and v_periods = 2) then
        raise exception 'Finish the first half and play the second half before ending the match.';
      end if;
      if f.period = 'second_half' then f.second_half_elapsed_sec := private.running_elapsed(f); end if;
      if f.period = 'first_half' then f.first_half_elapsed_sec := private.running_elapsed(f); end if;
      if f.period <> 'penalties' then f.timer_elapsed_sec := private.running_elapsed(f); end if;
      f.timer_started_at := null; f.status := 'completed'; f.period := 'full_time';
    when 'extra_time' then
      if f.stage <> 'knockout' then raise exception 'Extra time only applies to knockout matches.'; end if;
      if not v_extra then raise exception 'Extra time is turned off in Settings.'; end if;
      if f.home_score <> f.away_score then raise exception 'Extra time is only played when the score is level.'; end if;
      if f.status not in ('completed', 'paused', 'in_progress') or f.period in ('first_half', 'half_time', 'extra_time') then
        raise exception 'Extra time starts after the second half.';
      end if;
      f.period := 'extra_time'; f.status := 'in_progress';
      f.timer_started_at := v_now; f.timer_elapsed_sec := 0; f.added_time_sec := 0;
      f.phase_target_sec := private.phase_seconds(f, 'extra_time');
    when 'penalties' then
      if f.stage <> 'knockout' then raise exception 'Shootouts only apply to knockout matches.'; end if;
      if f.home_score <> f.away_score then raise exception 'A shootout is only needed when the score is level.'; end if;
      if f.period in ('first_half', 'half_time') then raise exception 'The shootout comes after full time.'; end if;
      if f.timer_started_at is not null then f.timer_elapsed_sec := private.running_elapsed(f); end if;
      f.timer_started_at := null; f.period := 'penalties'; f.status := 'paused';
    when 'resume_play' then
      -- Undo an accidental full-time before the result is confirmed.
      if f.status <> 'completed' then raise exception 'Only a finished match can be resumed.'; end if;
      if f.decided_by = 'forfeit' then raise exception 'Clear the forfeit first.'; end if;
      f.period := case when v_periods = 1 then 'first_half' else 'second_half' end;
      f.status := 'paused'; f.timer_started_at := null; f.submitted_at := null; f.submitted_by := null;
    when 'submit' then
      if f.status <> 'completed' then raise exception 'End the match before submitting the result.'; end if;
      f.submitted_at := v_now; f.submitted_by := auth.uid();
    when 'abandon' then
      if not (v_admin or exists (select 1 from public.match_officials o where o.fixture_id = f.id and o.user_id = auth.uid() and o.role = 'referee')) then
        raise exception 'Only the referee or a tournament admin can abandon a match.' using errcode = '42501';
      end if;
      if f.status not in ('scheduled', 'in_progress', 'paused', 'completed') then raise exception 'This match cannot be abandoned.'; end if;
      if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for abandoning the match.'; end if;
      if f.timer_started_at is not null then f.timer_elapsed_sec := private.running_elapsed(f); end if;
      f.timer_started_at := null; f.status := 'abandoned'; f.abandoned_reason := btrim(p_reason);
    when 'reinstate' then
      if not v_admin then raise exception 'Only a tournament admin can reinstate a match.' using errcode = '42501'; end if;
      if f.status <> 'abandoned' then raise exception 'Only abandoned matches can be reinstated.'; end if;
      f.status := case when f.period = 'not_started' then 'scheduled' else 'paused' end;
      f.abandoned_reason := null;
    when 'reset_to_scheduled' then
      if not v_admin then raise exception 'Only a tournament admin can reset a match.' using errcode = '42501'; end if;
      select count(*) into v_events from public.match_events where fixture_id = f.id;
      if v_events > 0 then raise exception 'Remove the recorded events before resetting this match.'; end if;
      f.status := 'scheduled'; f.period := 'not_started'; f.timer_started_at := null; f.timer_elapsed_sec := 0;
      f.phase_target_sec := null; f.added_time_sec := 0; f.first_half_elapsed_sec := null; f.second_half_elapsed_sec := null;
      f.submitted_at := null; f.submitted_by := null; f.abandoned_reason := null;
    else
      raise exception 'Unknown match command %.', p_command;
  end case;

  -- Nothing changed (e.g. a sync with nothing due): return without writing.
  if (to_jsonb(f) - 'state_version') = (to_jsonb(b) - 'state_version') then
    return f;
  end if;
  f.state_version := b.state_version + 1;

  v_prev := private.enter_internal();
  update public.fixtures set
    status = f.status, period = f.period, timer_started_at = f.timer_started_at, timer_elapsed_sec = f.timer_elapsed_sec,
    phase_target_sec = f.phase_target_sec, added_time_sec = f.added_time_sec,
    first_half_elapsed_sec = f.first_half_elapsed_sec, second_half_elapsed_sec = f.second_half_elapsed_sec,
    submitted_at = f.submitted_at, submitted_by = f.submitted_by, abandoned_reason = f.abandoned_reason,
    state_version = f.state_version
  where id = f.id
  returning * into f;
  perform private.exit_internal(v_prev);

  perform private.write_audit(f.tournament_id,
    case when p_command = 'sync' then 'match_auto_' || f.period::text else 'match_' || p_command end,
    'fixtures', f.id,
    jsonb_build_object('status', b.status, 'period', b.period, 'elapsed_sec', private.running_elapsed(b)),
    jsonb_build_object('status', f.status, 'period', f.period, 'elapsed_sec', f.timer_elapsed_sec,
                       'added_time_sec', f.added_time_sec, 'minutes', p_minutes),
    nullif(btrim(coalesce(p_reason, '')), ''));
  return f;
end $$;

-- ---------------------------------------------------------------------------
-- Guard: clock and phase columns change only through match_control.
-- ---------------------------------------------------------------------------
create or replace function private.guard_fixture_update() returns trigger
language plpgsql as $$
declare
  v_admin_status text[] := array['scheduled', 'postponed', 'cancelled'];
  v_clock text[] := array['period', 'timer_started_at', 'timer_elapsed_sec', 'phase_target_sec', 'added_time_sec',
                          'first_half_elapsed_sec', 'second_half_elapsed_sec', 'state_version', 'submitted_at',
                          'submitted_by', 'abandoned_reason'];
  v_structural text[] := array['home_team_id', 'away_team_id', 'home_source', 'away_source', 'stage', 'code', 'group_label', 'round_number'];
  v_col text;
begin
  if private.is_internal() then
    return new;
  end if;
  if new.id <> old.id or new.tournament_id <> old.tournament_id then
    raise exception 'Fixtures cannot be moved between tournaments.';
  end if;
  if old.status = 'confirmed' then
    raise exception 'This result is confirmed. Use "Correct result" to reopen it first.' using errcode = 'P0001';
  end if;
  if new.status = 'confirmed' then
    raise exception 'Results must be confirmed with the confirm action.' using errcode = 'P0001';
  end if;
  if new.home_score <> old.home_score or new.away_score <> old.away_score
     or new.home_penalties is distinct from old.home_penalties
     or new.away_penalties is distinct from old.away_penalties
     or new.winner_team_id is distinct from old.winner_team_id
     or new.decided_by is distinct from old.decided_by
     or new.confirmed_at is distinct from old.confirmed_at
     or new.confirmed_by is distinct from old.confirmed_by
     or new.correction_count <> old.correction_count then
    raise exception 'Scores are calculated from recorded match events and cannot be edited directly.' using errcode = 'P0001';
  end if;
  foreach v_col in array v_clock loop
    if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
      raise exception 'Use the match controls to change the match clock or phase.' using errcode = 'P0001';
    end if;
  end loop;
  if new.status <> old.status and not (old.status::text = any (v_admin_status) and new.status::text = any (v_admin_status)) then
    raise exception 'Use the match controls to start, pause or end a match.' using errcode = 'P0001';
  end if;

  if not private.is_admin(old.tournament_id) then
    if (to_jsonb(new) - array['referee_notes', 'notes', 'updated_at']) <> (to_jsonb(old) - array['referee_notes', 'notes', 'updated_at']) then
      raise exception 'Match officials can only edit notes here. Use the match controls for the clock.' using errcode = '42501';
    end if;
  elsif old.status::text <> all (v_admin_status) then
    foreach v_col in array v_structural loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        raise exception 'Teams and fixture structure cannot change after kick-off.' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- Timer and phase bookkeeping columns are not interesting in the generic audit
-- log (match_control writes its own entries).
create or replace function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_tournament uuid;
  v_ignore text[] := array['updated_at', 'timer_started_at', 'timer_elapsed_sec', 'period', 'phase_target_sec',
                           'added_time_sec', 'first_half_elapsed_sec', 'second_half_elapsed_sec', 'state_version',
                           'submitted_at', 'submitted_by', 'abandoned_reason'];
  v_live text[] := array['status', 'home_score', 'away_score', 'home_penalties', 'away_penalties', 'referee_notes', 'notes'];
begin
  v_tournament := case when tg_table_name = 'tournaments' then (v_row ->> 'id')::uuid
                       else (v_row ->> 'tournament_id')::uuid end;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
      return new;
    end if;
    if tg_table_name = 'fixtures'
       and (to_jsonb(new) - v_ignore - v_live) = (to_jsonb(old) - v_ignore - v_live)
       and (to_jsonb(old) ->> 'status') <> 'confirmed' and (to_jsonb(new) ->> 'status') <> 'confirmed'
       and coalesce((to_jsonb(old) ->> 'correction_count')::int, 0) = 0 then
      return new;
    end if;
  end if;
  perform private.write_audit(
    v_tournament, lower(tg_op), tg_table_name, (v_row ->> coalesce(tg_argv[0], 'id'))::uuid,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    null
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Match events: server-side period and match time, substitution limits.
-- ---------------------------------------------------------------------------
create or replace function private.validate_match_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_row public.match_events := coalesce(new, old);
  v_player_team uuid;
  v_max integer;
  v_subs integer;
  v_offset integer;
  v_elapsed integer;
begin
  select * into f from public.fixtures where id = v_row.fixture_id;
  if not found then
    if tg_op = 'DELETE' then
      return old;  -- cascading delete of the fixture itself
    end if;
    raise exception 'Fixture not found.';
  end if;
  if not private.is_internal() then
    if f.status = 'confirmed' then
      raise exception 'This result is confirmed. Use "Correct result" before changing match events.' using errcode = 'P0001';
    end if;
    if f.status in ('cancelled', 'postponed', 'abandoned') then
      raise exception 'Events cannot be recorded for a % match.', f.status using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  new.tournament_id := f.tournament_id;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    -- The server decides the period and match time from the stored clock.
    f := private.normalize_clock(f);
    new.period := coalesce(new.period, f.period);
    if new.match_second is null and f.period <> 'not_started' then
      v_elapsed := least(private.running_elapsed(f), coalesce(private.phase_target(f), private.running_elapsed(f)));
      v_offset := case f.period
        when 'first_half' then 0
        when 'half_time' then 0
        when 'second_half' then coalesce(f.first_half_elapsed_sec, private.phase_seconds(f, 'first_half'))
        when 'extra_time' then coalesce(f.first_half_elapsed_sec, 0) + coalesce(f.second_half_elapsed_sec, 0)
        else 0 end;
      new.match_second := case
        when f.period = 'half_time' then coalesce(f.first_half_elapsed_sec, 0)
        when f.period in ('full_time', 'penalties') then coalesce(f.first_half_elapsed_sec, 0) + coalesce(f.second_half_elapsed_sec, f.timer_elapsed_sec)
        else v_offset + v_elapsed end;
    end if;
  elsif new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'Event authorship cannot be changed.';
  end if;

  if new.event_type <> 'note' then
    if f.home_team_id is null or f.away_team_id is null then
      raise exception 'Both teams must be known before recording match events.';
    end if;
    if new.team_id not in (f.home_team_id, f.away_team_id) then
      raise exception 'The team is not playing in this match.';
    end if;
  end if;
  if new.player_id is not null then
    select p.team_id into v_player_team from public.players p where p.id = new.player_id;
    if v_player_team is distinct from new.team_id then
      raise exception 'The selected player is not in that team.';
    end if;
  end if;
  if new.assist_player_id is not null then
    if (select p.team_id from public.players p where p.id = new.assist_player_id) is distinct from new.team_id then
      raise exception 'The assisting player is not in that team.';
    end if;
    if new.assist_player_id = new.player_id then
      raise exception 'A player cannot assist their own goal.';
    end if;
  end if;
  if new.related_player_id is not null
     and (select p.team_id from public.players p where p.id = new.related_player_id) is distinct from new.team_id then
    raise exception 'The substituted player is not in that team.';
  end if;
  if new.event_type = 'substitution' and new.player_id is not null and new.player_id = new.related_player_id then
    raise exception 'The player coming on and going off must be different.';
  end if;
  if new.event_type in ('shootout_goal', 'shootout_miss') and f.stage <> 'knockout' then
    raise exception 'Penalty shootouts only apply to knockout matches.';
  end if;
  if new.event_type in ('yellow_card', 'red_card', 'sin_bin') and new.player_id is null then
    raise exception 'Select the player who received the card or time penalty.';
  end if;
  if tg_op = 'INSERT' and new.event_type = 'substitution' then
    select max_substitutions into v_max from public.tournament_settings where tournament_id = f.tournament_id;
    if v_max is not null then
      select count(*) into v_subs from public.match_events
        where fixture_id = f.id and team_id = new.team_id and event_type = 'substitution';
      if v_subs >= v_max then
        raise exception 'This team has used all % substitutions allowed by the tournament rules.', v_max;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Discipline records follow corrections: an edited card event rebuilds its record.
create or replace function private.discipline_from_event_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_type is not distinct from old.event_type and new.player_id is not distinct from old.player_id
     and new.team_id is not distinct from old.team_id and new.detail is not distinct from old.detail
     and new.duration_min is not distinct from old.duration_min then
    return null;
  end if;
  -- Rebuild this event's discipline record (and any automatic suspension) from the corrected event.
  delete from public.disciplinary_records where match_event_id = new.id;
  perform private.discipline_rebuild(new);
  return null;
end $$;

-- Wrap the existing insert-trigger logic so it can be called for a single event.
create or replace function private.discipline_rebuild(e public.match_events) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.tournament_settings;
  v_incident text;
  v_card text;
  v_record uuid;
  v_yellows_this_match integer;
  v_yellows_total integer;
  v_referee uuid;
begin
  if e.event_type not in ('yellow_card', 'red_card', 'sin_bin') or e.player_id is null then
    return;
  end if;
  select * into s from public.tournament_settings where tournament_id = e.tournament_id;
  if e.event_type = 'yellow_card' then
    select count(*) into v_yellows_this_match from public.match_events x
      where x.fixture_id = e.fixture_id and x.player_id = e.player_id and x.event_type = 'yellow_card' and x.created_at <= e.created_at;
    if v_yellows_this_match >= 2 and s.second_yellow_is_red then
      v_incident := 'second_yellow'; v_card := 'red';
    else
      v_incident := 'yellow_card'; v_card := 'yellow';
    end if;
  elsif e.event_type = 'red_card' then
    v_incident := 'red_card'; v_card := 'red';
  else
    v_incident := 'sin_bin'; v_card := 'none';
  end if;
  select o.user_id into v_referee from public.match_officials o
    where o.fixture_id = e.fixture_id and o.role = 'referee' order by o.created_at limit 1;
  insert into public.disciplinary_records
    (tournament_id, player_id, team_id, fixture_id, match_event_id, incident_type, card_type, reason,
     referee_id, occurred_at, created_by)
  values
    (e.tournament_id, e.player_id, e.team_id, e.fixture_id, e.id, v_incident, v_card,
     coalesce(e.detail, case when e.event_type = 'sin_bin' and e.duration_min is not null then e.duration_min || '-minute time penalty' end),
     v_referee, e.created_at, e.created_by)
  returning id into v_record;
  if v_card = 'red' and coalesce(s.red_card_suspension_matches, 0) > 0 then
    insert into public.suspensions (tournament_id, player_id, team_id, disciplinary_record_id,
      starts_after_fixture_id, matches, reason, source, created_by)
    values (e.tournament_id, e.player_id, e.team_id, v_record, e.fixture_id, s.red_card_suspension_matches,
      case when v_incident = 'second_yellow' then 'Automatic: sent off for a second yellow card' else 'Automatic: red card' end,
      'automatic', e.created_by);
  end if;
  if v_incident = 'yellow_card' and s.yellow_accumulation_threshold is not null
     and coalesce(s.yellow_accumulation_suspension_matches, 0) > 0 then
    select count(*) into v_yellows_total from public.disciplinary_records d
      where d.tournament_id = e.tournament_id and d.player_id = e.player_id and d.incident_type = 'yellow_card';
    if v_yellows_total > 0 and v_yellows_total % s.yellow_accumulation_threshold = 0 then
      insert into public.suspensions (tournament_id, player_id, team_id, disciplinary_record_id,
        starts_after_fixture_id, matches, reason, source, created_by)
      values (e.tournament_id, e.player_id, e.team_id, v_record, e.fixture_id, s.yellow_accumulation_suspension_matches,
        'Automatic: ' || v_yellows_total || ' yellow cards accumulated', 'automatic', e.created_by);
    end if;
  end if;
end $$;
revoke execute on function private.discipline_rebuild(public.match_events) from public, anon, authenticated;

create trigger match_events_discipline_update after update on public.match_events
  for each row execute function private.discipline_from_event_update();

-- ---------------------------------------------------------------------------
-- Event corrections: always with a reason, original kept in the audit log.
-- ---------------------------------------------------------------------------
create or replace function public.correct_match_event(p_event uuid, p_changes jsonb, p_reason text)
returns public.match_events
language plpgsql security definer set search_path = public as $$
declare
  e public.match_events;
begin
  select * into e from public.match_events where id = p_event for update;
  if not found then raise exception 'Event not found.'; end if;
  if not private.can_score_fixture(e.fixture_id) then
    raise exception 'You cannot correct events for this match.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for the correction.';
  end if;
  perform set_config('app.audit_reason', btrim(p_reason), true);
  update public.match_events set
    event_type = coalesce(nullif(p_changes ->> 'event_type', '')::public.event_type, event_type),
    team_id = case when p_changes ? 'team_id' then nullif(p_changes ->> 'team_id', '')::uuid else team_id end,
    player_id = case when p_changes ? 'player_id' then nullif(p_changes ->> 'player_id', '')::uuid else player_id end,
    assist_player_id = case when p_changes ? 'assist_player_id' then nullif(p_changes ->> 'assist_player_id', '')::uuid else assist_player_id end,
    related_player_id = case when p_changes ? 'related_player_id' then nullif(p_changes ->> 'related_player_id', '')::uuid else related_player_id end,
    match_second = case when p_changes ? 'match_second' then nullif(p_changes ->> 'match_second', '')::integer else match_second end,
    detail = case when p_changes ? 'detail' then nullif(btrim(p_changes ->> 'detail'), '') else detail end
  where id = e.id
  returning * into e;
  perform set_config('app.audit_reason', '', true);
  return e;
end $$;

create or replace function public.delete_match_event(p_event uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.match_events;
begin
  select * into e from public.match_events where id = p_event for update;
  if not found then raise exception 'Event not found.'; end if;
  if not private.can_score_fixture(e.fixture_id) then
    raise exception 'You cannot remove events for this match.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for removing the event.';
  end if;
  perform set_config('app.audit_reason', btrim(p_reason), true);
  delete from public.match_events where id = e.id;
  perform set_config('app.audit_reason', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Player participation (for "matches played"). If no lineup is recorded, the
-- team's confirmed, eligible squad is recorded when the result is confirmed.
-- ---------------------------------------------------------------------------
create table public.match_participants (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  fixture_id uuid not null references public.fixtures (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  source text not null default 'recorded' check (source in ('recorded', 'default')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (fixture_id, player_id)
);
create index match_participants_player_idx on public.match_participants (player_id);

create or replace function private.validate_participant() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = coalesce(new.fixture_id, old.fixture_id);
  if not found then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then return old; end if;
  new.tournament_id := f.tournament_id;
  if new.team_id not in (f.home_team_id, f.away_team_id) then
    raise exception 'That team is not playing in this match.';
  end if;
  if (select p.team_id from public.players p where p.id = new.player_id) is distinct from new.team_id then
    raise exception 'The player is not in that team.';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger match_participants_validate before insert or update or delete on public.match_participants
  for each row execute function private.validate_participant();

alter table public.match_participants enable row level security;
grant select, insert, update, delete on public.match_participants to authenticated;
create policy participants_select on public.match_participants for select to authenticated
  using (private.is_member(tournament_id));
create policy participants_write on public.match_participants for all to authenticated
  using (private.is_admin(tournament_id)
         or (private.is_fixture_official(fixture_id)
             and (select f.status from public.fixtures f where f.id = fixture_id) <> 'confirmed'))
  with check (private.is_admin(tournament_id)
         or (private.is_fixture_official(fixture_id)
             and (select f.status from public.fixtures f where f.id = fixture_id) <> 'confirmed'));

-- ---------------------------------------------------------------------------
-- Confirm result: also records default participation.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_match_result(p_fixture uuid, p_note text default null)
returns public.fixtures
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_before jsonb;
  v_winner uuid;
  v_decided text;
  v_prev text;
  v_team uuid;
begin
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  if not private.can_confirm(f) then
    raise exception 'You are not authorised to confirm this result.' using errcode = '42501';
  end if;
  if f.status = 'confirmed' then
    raise exception 'This result is already confirmed.';
  end if;
  if f.status = 'abandoned' then
    raise exception 'This match was abandoned. Reinstate it, replay it or record a forfeit first.';
  end if;
  if f.status <> 'completed' then
    raise exception 'End the match before confirming the result.';
  end if;
  if f.home_team_id is null or f.away_team_id is null then
    raise exception 'Both teams must be set before confirming.';
  end if;
  v_before := to_jsonb(f);

  v_decided := case when f.decided_by = 'forfeit' then 'forfeit' else 'normal' end;
  if f.home_score > f.away_score then
    v_winner := f.home_team_id;
  elsif f.away_score > f.home_score then
    v_winner := f.away_team_id;
  elsif f.stage = 'knockout' then
    if f.home_penalties is null or f.away_penalties is null or f.home_penalties = f.away_penalties then
      raise exception 'Knockout matches need a winner. Record the penalty shootout before confirming.' using errcode = 'P0001';
    end if;
    v_winner := case when f.home_penalties > f.away_penalties then f.home_team_id else f.away_team_id end;
    v_decided := 'penalties';
  else
    v_winner := null;
  end if;

  v_prev := private.enter_internal();
  update public.fixtures set
    status = 'confirmed', period = 'full_time', winner_team_id = v_winner, decided_by = v_decided,
    confirmed_at = now(), confirmed_by = auth.uid(), state_version = state_version + 1,
    notes = coalesce(nullif(btrim(p_note), ''), notes)
  where id = f.id
  returning * into f;
  perform private.propagate_result(f.id, false);
  if f.decided_by <> 'forfeit' then
    foreach v_team in array array[f.home_team_id, f.away_team_id] loop
      if not exists (select 1 from public.match_participants mp where mp.fixture_id = f.id and mp.team_id = v_team) then
        insert into public.match_participants (tournament_id, fixture_id, team_id, player_id, source, created_by)
        select f.tournament_id, f.id, v_team, p.id, 'default', auth.uid()
        from public.players p
        where p.team_id = v_team and p.registration_status = 'confirmed' and p.eligibility_status = 'eligible'
        on conflict do nothing;
      end if;
    end loop;
  end if;
  perform private.exit_internal(v_prev);

  perform private.write_audit(f.tournament_id,
    case when f.correction_count > 0 then 'result_reconfirmed' else 'result_confirmed' end,
    'fixtures', f.id,
    jsonb_build_object('home_score', v_before -> 'home_score', 'away_score', v_before -> 'away_score',
                       'status', v_before -> 'status'),
    jsonb_build_object('home_score', f.home_score, 'away_score', f.away_score,
                       'home_penalties', f.home_penalties, 'away_penalties', f.away_penalties,
                       'winner_team_id', f.winner_team_id),
    p_note);
  return f;
end $$;

-- Seeding the knockout from final standings marks the league as confirmed.
create or replace function private.mark_league_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action = 'knockout_seeded' and new.tournament_id is not null then
    update public.tournaments set league_confirmed_at = now(), league_confirmed_by = new.actor_id
    where id = new.tournament_id;
  end if;
  return null;
end $$;
create trigger audit_marks_league_confirmed after insert on public.audit_logs
  for each row execute function private.mark_league_confirmed();

grant execute on function public.match_control(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.correct_match_event(uuid, jsonb, text) to authenticated;
grant execute on function public.delete_match_event(uuid, text) to authenticated;
revoke execute on function public.match_control(uuid, text, integer, integer, text) from public, anon;
revoke execute on function public.correct_match_event(uuid, jsonb, text) from public, anon;
revoke execute on function public.delete_match_event(uuid, text) from public, anon;
