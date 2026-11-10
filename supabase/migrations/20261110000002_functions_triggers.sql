-- Helper functions, data-integrity guards and automation triggers.
-- Internal functions live in the "private" schema, which PostgREST does not expose.

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal-operation flag. Security-definer functions set it while they make
-- changes that ordinary clients are not allowed to make directly.
-- ---------------------------------------------------------------------------
create or replace function private.is_internal() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.internal', true), '') = 'on'
$$;

create or replace function private.enter_internal() returns text
language plpgsql as $$
declare v_prev text := coalesce(current_setting('app.internal', true), '');
begin
  perform set_config('app.internal', 'on', true);
  return v_prev;
end $$;

create or replace function private.exit_internal(p_prev text) returns void
language plpgsql as $$
begin
  perform set_config('app.internal', coalesce(p_prev, ''), true);
end $$;

-- ---------------------------------------------------------------------------
-- Permission helpers used by RLS policies
-- ---------------------------------------------------------------------------
create or replace function private.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function private.member_role(p_tournament uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select m.role from public.tournament_members m
  where m.tournament_id = p_tournament and m.user_id = auth.uid()
$$;

create or replace function private.is_member(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_super_admin() or exists (
    select 1 from public.tournament_members m
    where m.tournament_id = p_tournament and m.user_id = auth.uid()
  )
$$;

create or replace function private.is_admin(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_super_admin() or exists (
    select 1 from public.tournament_members m
    where m.tournament_id = p_tournament and m.user_id = auth.uid() and m.role = 'tournament_admin'
  )
$$;

create or replace function private.is_fixture_official(p_fixture uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.match_officials o
    join public.tournament_members m
      on m.tournament_id = o.tournament_id and m.user_id = o.user_id
    where o.fixture_id = p_fixture and o.user_id = auth.uid()
      and m.role in ('referee', 'scorekeeper', 'tournament_admin')
  )
$$;

create or replace function private.can_score_fixture(p_fixture uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_admin((select f.tournament_id from public.fixtures f where f.id = p_fixture))
      or private.is_fixture_official(p_fixture)
$$;

create or replace function private.is_public(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select t.public_enabled from public.tournaments t where t.id = p_tournament), false)
$$;

create or replace function private.fixtures_public(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select t.public_enabled and t.fixtures_published
                   from public.tournaments t where t.id = p_tournament), false)
$$;

grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------------
create or replace function private.write_audit(
  p_tournament uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (tournament_id, actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_tournament, auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after,
          coalesce(p_reason, nullif(current_setting('app.audit_reason', true), '')));
end $$;
revoke execute on function private.write_audit(uuid, text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;

create or replace function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_tournament uuid;
  v_ignore text[] := array['updated_at', 'timer_started_at', 'timer_elapsed_sec', 'period'];
begin
  v_tournament := case when tg_table_name = 'tournaments' then (v_row ->> 'id')::uuid
                       else (v_row ->> 'tournament_id')::uuid end;
  if tg_op = 'UPDATE' then
    -- Skip no-op and timer-only updates to keep the log meaningful.
    if (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
      return new;
    end if;
    -- Live status changes are noise; confirmation and corrections are logged by the RPCs.
    if tg_table_name = 'fixtures'
       and (to_jsonb(new) - v_ignore - array['status', 'home_score', 'away_score', 'home_penalties', 'away_penalties', 'referee_notes', 'notes'])
         = (to_jsonb(old) - v_ignore - array['status', 'home_score', 'away_score', 'home_penalties', 'away_penalties', 'referee_notes', 'notes'])
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
-- New auth user -> profile. The very first user becomes Super Admin so the
-- platform can be bootstrapped without manual SQL.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  perform pg_advisory_xact_lock(hashtext('ctm_first_user'));
  select not exists (select 1 from public.profiles) into v_first;
  insert into public.profiles (id, email, full_name, is_super_admin, can_create_tournaments)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    v_first,
    v_first
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.guard_profile_update() returns trigger
language plpgsql as $$
begin
  if private.is_internal() or auth.uid() is null then
    return new;  -- service role / migrations
  end if;
  if (new.is_super_admin is distinct from old.is_super_admin
      or new.can_create_tournaments is distinct from old.can_create_tournaments)
     and not private.is_super_admin() then
    raise exception 'Only a Super Admin can change platform permissions.' using errcode = '42501';
  end if;
  if new.id = auth.uid() and old.is_super_admin and not new.is_super_admin
     and not exists (select 1 from public.profiles p where p.is_super_admin and p.id <> new.id) then
    raise exception 'You are the only Super Admin. Promote someone else first.';
  end if;
  if new.email is distinct from old.email then
    raise exception 'Email is managed by authentication and cannot be edited here.';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Teams / players integrity
-- ---------------------------------------------------------------------------
create or replace function private.validate_player() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team_tournament uuid;
  v_max integer;
  v_count integer;
begin
  if new.team_id is not null then
    select t.tournament_id into v_team_tournament from public.teams t where t.id = new.team_id for update;
    if v_team_tournament is distinct from new.tournament_id then
      raise exception 'The selected team belongs to a different tournament.';
    end if;
    if new.registration_status = 'confirmed'
       and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id
            or new.registration_status is distinct from old.registration_status) then
      select s.max_squad_size into v_max from public.tournament_settings s where s.tournament_id = new.tournament_id;
      select count(*) into v_count from public.players p
        where p.team_id = new.team_id and p.registration_status = 'confirmed' and p.id <> new.id;
      if v_max is not null and v_count >= v_max then
        raise exception 'Squad is full: this tournament allows a maximum of % players per team.', v_max
          using errcode = 'P0001', hint = 'squad_full';
      end if;
    end if;
  end if;
  if new.is_captain and new.team_id is null then
    raise exception 'A captain must belong to a team.';
  end if;
  if new.registration_status = 'withdrawn' then
    new.is_captain := false;
  end if;
  return new;
end $$;

create trigger players_validate before insert or update on public.players
  for each row execute function private.validate_player();

create or replace function private.validate_player_contact() returns trigger
language plpgsql as $$
begin
  if (select p.tournament_id from public.players p where p.id = new.player_id) is distinct from new.tournament_id then
    raise exception 'Contact tournament does not match player tournament.';
  end if;
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');
  return new;
end $$;

create trigger player_contacts_validate before insert or update on public.player_contacts
  for each row execute function private.validate_player_contact();

-- ---------------------------------------------------------------------------
-- Fixtures integrity
-- ---------------------------------------------------------------------------
create or replace function private.validate_fixture() returns trigger
language plpgsql as $$
begin
  if new.home_team_id is not null
     and (select t.tournament_id from public.teams t where t.id = new.home_team_id) is distinct from new.tournament_id then
    raise exception 'Home team belongs to a different tournament.';
  end if;
  if new.away_team_id is not null
     and (select t.tournament_id from public.teams t where t.id = new.away_team_id) is distinct from new.tournament_id then
    raise exception 'Away team belongs to a different tournament.';
  end if;
  if new.pitch_id is not null
     and (select p.tournament_id from public.pitches p where p.id = new.pitch_id) is distinct from new.tournament_id then
    raise exception 'Pitch belongs to a different tournament.';
  end if;
  return new;
end $$;

create trigger fixtures_validate before insert or update on public.fixtures
  for each row execute function private.validate_fixture();

-- Clients may not edit derived or locked columns directly. Confirmation,
-- correction, forfeits and knockout advancement go through RPC functions.
create or replace function private.guard_fixture_update() returns trigger
language plpgsql as $$
declare
  v_live text[] := array['status', 'period', 'timer_started_at', 'timer_elapsed_sec', 'referee_notes', 'notes', 'updated_at'];
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

  if not private.is_admin(old.tournament_id) then
    if (to_jsonb(new) - v_live) <> (to_jsonb(old) - v_live) then
      raise exception 'Match officials can only update match status, timer and notes.' using errcode = '42501';
    end if;
    if new.status not in ('in_progress', 'paused', 'completed') and new.status <> old.status then
      raise exception 'Match officials cannot set a match to %.', new.status using errcode = '42501';
    end if;
  elsif old.status not in ('scheduled', 'postponed', 'cancelled') then
    foreach v_col in array v_structural loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        raise exception 'Teams and fixture structure cannot change after kick-off.' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger fixtures_guard before update on public.fixtures
  for each row execute function private.guard_fixture_update();

create or replace function private.guard_fixture_delete() returns trigger
language plpgsql as $$
begin
  if private.is_internal() then
    return old;
  end if;
  if old.status not in ('scheduled', 'postponed', 'cancelled') then
    raise exception 'Fixture % has already started or been played and cannot be deleted.', old.code using errcode = 'P0001';
  end if;
  return old;
end $$;

create trigger fixtures_guard_delete before delete on public.fixtures
  for each row execute function private.guard_fixture_delete();

-- ---------------------------------------------------------------------------
-- Match events: validation, score recalculation and discipline automation
-- ---------------------------------------------------------------------------
create or replace function private.recompute_fixture_score(p_fixture uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_prev text;
  v_has_shootout boolean;
begin
  select * into f from public.fixtures where id = p_fixture;
  if not found or f.decided_by = 'forfeit' then
    return;
  end if;
  select exists (select 1 from public.match_events e
                 where e.fixture_id = f.id and e.event_type in ('shootout_goal', 'shootout_miss'))
    into v_has_shootout;
  v_prev := private.enter_internal();
  update public.fixtures x set
    home_score = (select count(*) from public.match_events e where e.fixture_id = f.id and (
                    (e.event_type in ('goal', 'penalty_goal') and e.team_id = f.home_team_id)
                 or (e.event_type = 'own_goal' and e.team_id = f.away_team_id))),
    away_score = (select count(*) from public.match_events e where e.fixture_id = f.id and (
                    (e.event_type in ('goal', 'penalty_goal') and e.team_id = f.away_team_id)
                 or (e.event_type = 'own_goal' and e.team_id = f.home_team_id))),
    home_penalties = case when v_has_shootout then (select count(*) from public.match_events e
                      where e.fixture_id = f.id and e.event_type = 'shootout_goal' and e.team_id = f.home_team_id) end,
    away_penalties = case when v_has_shootout then (select count(*) from public.match_events e
                      where e.fixture_id = f.id and e.event_type = 'shootout_goal' and e.team_id = f.away_team_id) end
  where x.id = f.id;
  perform private.exit_internal(v_prev);
end $$;
revoke execute on function private.recompute_fixture_score(uuid) from public, anon, authenticated;

create or replace function private.validate_match_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_row public.match_events := coalesce(new, old);
  v_player_team uuid;
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
    if f.status in ('cancelled', 'postponed') then
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
  if new.event_type in ('shootout_goal', 'shootout_miss') and f.stage <> 'knockout' then
    raise exception 'Penalty shootouts only apply to knockout matches.';
  end if;
  if new.event_type in ('yellow_card', 'red_card', 'sin_bin') and new.player_id is null then
    raise exception 'Select the player who received the card or time penalty.';
  end if;
  return new;
end $$;

create trigger match_events_validate before insert or update or delete on public.match_events
  for each row execute function private.validate_match_event();

create or replace function private.after_match_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.recompute_fixture_score(coalesce(new.fixture_id, old.fixture_id));
  if tg_op = 'UPDATE' and new.fixture_id <> old.fixture_id then
    perform private.recompute_fixture_score(old.fixture_id);
  end if;
  return null;
end $$;

create trigger match_events_after after insert or update or delete on public.match_events
  for each row execute function private.after_match_event();

-- Cards create discipline records; suspensions are only created when the
-- organiser has configured the corresponding rule (never invented).
create or replace function private.discipline_from_event() returns trigger
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
  if new.event_type not in ('yellow_card', 'red_card', 'sin_bin') or new.player_id is null then
    return null;
  end if;
  select * into s from public.tournament_settings where tournament_id = new.tournament_id;

  if new.event_type = 'yellow_card' then
    select count(*) into v_yellows_this_match from public.match_events e
      where e.fixture_id = new.fixture_id and e.player_id = new.player_id and e.event_type = 'yellow_card';
    if v_yellows_this_match >= 2 and s.second_yellow_is_red then
      v_incident := 'second_yellow'; v_card := 'red';
    else
      v_incident := 'yellow_card'; v_card := 'yellow';
    end if;
  elsif new.event_type = 'red_card' then
    v_incident := 'red_card'; v_card := 'red';
  else
    v_incident := 'sin_bin'; v_card := 'none';
  end if;

  select o.user_id into v_referee from public.match_officials o
    where o.fixture_id = new.fixture_id and o.role = 'referee' order by o.created_at limit 1;

  insert into public.disciplinary_records
    (tournament_id, player_id, team_id, fixture_id, match_event_id, incident_type, card_type, reason,
     referee_id, occurred_at, created_by)
  values
    (new.tournament_id, new.player_id, new.team_id, new.fixture_id, new.id, v_incident, v_card,
     coalesce(new.detail, case when new.event_type = 'sin_bin' and new.duration_min is not null
                               then new.duration_min || '-minute time penalty' end),
     v_referee, new.created_at, new.created_by)
  returning id into v_record;

  if v_card = 'red' and coalesce(s.red_card_suspension_matches, 0) > 0 then
    insert into public.suspensions (tournament_id, player_id, team_id, disciplinary_record_id,
      starts_after_fixture_id, matches, reason, source, created_by)
    values (new.tournament_id, new.player_id, new.team_id, v_record, new.fixture_id,
      s.red_card_suspension_matches,
      case when v_incident = 'second_yellow' then 'Automatic: sent off for a second yellow card'
           else 'Automatic: red card' end,
      'automatic', new.created_by);
  end if;

  if v_incident = 'yellow_card' and s.yellow_accumulation_threshold is not null
     and coalesce(s.yellow_accumulation_suspension_matches, 0) > 0 then
    select count(*) into v_yellows_total from public.disciplinary_records d
      where d.tournament_id = new.tournament_id and d.player_id = new.player_id and d.incident_type = 'yellow_card';
    if v_yellows_total > 0 and v_yellows_total % s.yellow_accumulation_threshold = 0 then
      insert into public.suspensions (tournament_id, player_id, team_id, disciplinary_record_id,
        starts_after_fixture_id, matches, reason, source, created_by)
      values (new.tournament_id, new.player_id, new.team_id, v_record, new.fixture_id,
        s.yellow_accumulation_suspension_matches,
        'Automatic: ' || v_yellows_total || ' yellow cards accumulated', 'automatic', new.created_by);
    end if;
  end if;
  return null;
end $$;

create trigger match_events_discipline after insert on public.match_events
  for each row execute function private.discipline_from_event();

-- ---------------------------------------------------------------------------
-- Audit triggers
-- ---------------------------------------------------------------------------
create trigger audit_fixtures after insert or update or delete on public.fixtures
  for each row execute function private.audit_trigger();
create trigger audit_match_events after update or delete on public.match_events
  for each row execute function private.audit_trigger();
create trigger audit_players after update or delete on public.players
  for each row execute function private.audit_trigger();
create trigger audit_teams after update or delete on public.teams
  for each row execute function private.audit_trigger();
create trigger audit_settings after update on public.tournament_settings
  for each row execute function private.audit_trigger('tournament_id');
create trigger audit_members after insert or update or delete on public.tournament_members
  for each row execute function private.audit_trigger();
create trigger audit_suspensions after insert or update or delete on public.suspensions
  for each row execute function private.audit_trigger();
create trigger audit_tiebreak_decisions after insert or update or delete on public.tiebreak_decisions
  for each row execute function private.audit_trigger();
create trigger audit_decisions after update on public.tournament_decisions
  for each row execute function private.audit_trigger();
create trigger audit_registrations after update on public.registrations
  for each row execute function private.audit_trigger();
create trigger audit_tournaments after update or delete on public.tournaments
  for each row execute function private.audit_trigger();
