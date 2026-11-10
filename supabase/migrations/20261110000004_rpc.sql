-- Transactional server-side operations exposed as RPC functions.
-- Each function checks permissions itself because it runs as SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- Tournament creation
-- ---------------------------------------------------------------------------
create or replace function private.unique_slug(p_base text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'));
  v_slug text;
  v_n integer := 1;
begin
  if v_base = '' then v_base := 'tournament'; end if;
  v_base := left(v_base, 70);
  v_slug := v_base;
  while exists (select 1 from public.tournaments where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end $$;

create or replace function private.can_create_tournaments() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_super_admin or p.can_create_tournaments from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.create_tournament(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t jsonb := coalesce(p -> 'tournament', '{}'::jsonb);
  v_id uuid;
  v_settings public.tournament_settings;
  v_item jsonb;
  v_i integer := 0;
begin
  if auth.uid() is null or not private.can_create_tournaments() then
    raise exception 'You do not have permission to create tournaments.' using errcode = '42501';
  end if;

  insert into public.tournaments (slug, name, description, logo_url, venue, organiser, start_date, end_date,
    daily_start_time, daily_end_time, timezone, status, format, template_key, created_by)
  values (
    private.unique_slug(coalesce(nullif(t ->> 'slug', ''), t ->> 'name')),
    btrim(t ->> 'name'),
    nullif(t ->> 'description', ''),
    nullif(t ->> 'logo_url', ''),
    nullif(t ->> 'venue', ''),
    nullif(t ->> 'organiser', ''),
    nullif(t ->> 'start_date', '')::date,
    nullif(t ->> 'end_date', '')::date,
    nullif(t ->> 'daily_start_time', '')::time,
    nullif(t ->> 'daily_end_time', '')::time,
    coalesce(nullif(t ->> 'timezone', ''), 'UTC'),
    coalesce(nullif(t ->> 'status', ''), 'draft')::public.tournament_status,
    coalesce(nullif(t ->> 'format', ''), 'round_robin')::public.tournament_format,
    nullif(t ->> 'template_key', ''),
    auth.uid()
  )
  returning id into v_id;

  -- Settings: start from column defaults, then overlay provided keys.
  insert into public.tournament_settings (tournament_id) values (v_id) returning * into v_settings;
  delete from public.tournament_settings where tournament_id = v_id;
  insert into public.tournament_settings
    select (jsonb_populate_record(v_settings,
              (coalesce(p -> 'settings', '{}'::jsonb) - 'tournament_id' - 'updated_at')
              || jsonb_build_object('tournament_id', v_id))).*;

  insert into public.tournament_members (tournament_id, user_id, role, created_by)
  values (v_id, auth.uid(), 'tournament_admin', auth.uid());

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'pitches', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.pitches (tournament_id, name, sort_order, available_from, available_until)
    values (v_id, btrim(v_item ->> 'name'), v_i,
            nullif(v_item ->> 'available_from', '')::time, nullif(v_item ->> 'available_until', '')::time);
  end loop;

  v_i := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'teams', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.teams (tournament_id, name, colour, is_placeholder, seed)
    values (v_id, btrim(v_item ->> 'name'), nullif(v_item ->> 'colour', ''),
            coalesce((v_item ->> 'is_placeholder')::boolean, false), v_i);
  end loop;

  v_i := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'rules', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.tournament_rules (tournament_id, category, title, body, sort_order, needs_decision, updated_by)
    values (v_id, coalesce(nullif(v_item ->> 'category', ''), 'general')::public.rule_category,
            v_item ->> 'title', coalesce(v_item ->> 'body', ''), v_i,
            coalesce((v_item ->> 'needs_decision')::boolean, false), auth.uid());
  end loop;

  v_i := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'decisions', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.tournament_decisions (tournament_id, key, question, context, options, sort_order)
    values (v_id, v_item ->> 'key', v_item ->> 'question', v_item ->> 'context',
            coalesce(array(select jsonb_array_elements_text(v_item -> 'options')), '{}'), v_i);
  end loop;

  perform private.write_audit(v_id, 'create', 'tournaments', v_id, null,
    jsonb_build_object('name', t ->> 'name', 'template', t ->> 'template_key'), null);
  return v_id;
end $$;

-- Copy configuration into a new tournament (used for "archive and start the next one").
create or replace function public.clone_tournament(
  p_source uuid, p_name text, p_start_date date default null, p_copy_teams boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  src public.tournaments;
  v_id uuid;
begin
  if not private.is_admin(p_source) or not private.can_create_tournaments() then
    raise exception 'You do not have permission to copy this tournament.' using errcode = '42501';
  end if;
  select * into src from public.tournaments where id = p_source;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Enter a name for the new tournament.';
  end if;

  insert into public.tournaments (slug, name, description, logo_url, venue, organiser, start_date, end_date,
    daily_start_time, daily_end_time, timezone, status, format, template_key, created_by)
  values (private.unique_slug(p_name), btrim(p_name), src.description, src.logo_url, src.venue, src.organiser,
    p_start_date, case when p_start_date is not null and src.start_date is not null and src.end_date is not null
                       then p_start_date + (src.end_date - src.start_date) end,
    src.daily_start_time, src.daily_end_time, src.timezone, 'draft', src.format, src.template_key, auth.uid())
  returning id into v_id;

  insert into public.tournament_settings
    select (jsonb_populate_record(s, jsonb_build_object('tournament_id', v_id))).*
    from public.tournament_settings s where s.tournament_id = p_source;

  insert into public.tournament_members (tournament_id, user_id, role, created_by)
  values (v_id, auth.uid(), 'tournament_admin', auth.uid());

  insert into public.pitches (tournament_id, name, sort_order, available_from, available_until)
    select v_id, name, sort_order, available_from, available_until from public.pitches where tournament_id = p_source;
  insert into public.tournament_rules (tournament_id, category, title, body, sort_order, needs_decision, updated_by)
    select v_id, category, title, body, sort_order, needs_decision, auth.uid()
    from public.tournament_rules where tournament_id = p_source;
  insert into public.tournament_decisions (tournament_id, key, question, context, options, status, resolution, sort_order)
    select v_id, key, question, context, options, status, resolution, sort_order
    from public.tournament_decisions where tournament_id = p_source;
  if p_copy_teams then
    insert into public.teams (tournament_id, name, short_name, colour, logo_url, seed, is_placeholder)
      select v_id, name, short_name, colour, logo_url, seed, is_placeholder from public.teams where tournament_id = p_source;
  end if;

  perform private.write_audit(v_id, 'clone', 'tournaments', v_id, null,
    jsonb_build_object('source', p_source, 'copy_teams', p_copy_teams), null);
  return v_id;
end $$;

create or replace function public.delete_tournament(p_tournament uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_prev text;
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can delete tournaments.' using errcode = '42501';
  end if;
  select name into v_name from public.tournaments where id = p_tournament;
  if v_name is null then
    raise exception 'Tournament not found.';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'Type the tournament name exactly to confirm deletion.';
  end if;
  v_prev := private.enter_internal();
  delete from public.tournaments where id = p_tournament;
  perform private.exit_internal(v_prev);
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: atomic replacement of a generated plan
-- ---------------------------------------------------------------------------
create or replace function public.replace_fixtures(p_tournament uuid, p_scope text, p_fixtures jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_count integer;
  v_published boolean;
  v_stages public.fixture_stage[];
begin
  if not private.is_admin(p_tournament) then
    raise exception 'Only tournament admins can generate fixtures.' using errcode = '42501';
  end if;
  v_stages := case p_scope
    when 'all' then array['league', 'group', 'knockout']::public.fixture_stage[]
    when 'league' then array['league', 'group']::public.fixture_stage[]
    when 'knockout' then array['knockout']::public.fixture_stage[]
    else null end;
  if v_stages is null then
    raise exception 'Unknown fixture scope %.', p_scope;
  end if;

  select fixtures_published into v_published from public.tournaments where id = p_tournament for update;
  if v_published then
    raise exception 'Fixtures are published. Unpublish them before regenerating.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fixtures f where f.tournament_id = p_tournament and f.stage = any (v_stages)
             and f.status not in ('scheduled', 'postponed', 'cancelled')) then
    raise exception 'Some matches have already started or been played, so fixtures cannot be regenerated.' using errcode = 'P0001';
  end if;

  v_prev := private.enter_internal();
  delete from public.fixtures where tournament_id = p_tournament and stage = any (v_stages);
  insert into public.fixtures (tournament_id, code, stage, round_number, round_name, group_label, match_order,
    home_team_id, away_team_id, home_source, away_source, pitch_id, scheduled_date, scheduled_time, duration_min)
  select p_tournament, x.code, x.stage, coalesce(x.round_number, 1), x.round_name, x.group_label,
         coalesce(x.match_order, 0), x.home_team_id, x.away_team_id, x.home_source, x.away_source,
         x.pitch_id, x.scheduled_date, x.scheduled_time, x.duration_min
  from jsonb_to_recordset(coalesce(p_fixtures, '[]'::jsonb)) as x(
    code text, stage public.fixture_stage, round_number integer, round_name text, group_label text,
    match_order integer, home_team_id uuid, away_team_id uuid, home_source text, away_source text,
    pitch_id uuid, scheduled_date date, scheduled_time time, duration_min integer);
  get diagnostics v_count = row_count;
  perform private.exit_internal(v_prev);

  perform private.write_audit(p_tournament, 'fixtures_generated', 'fixtures', null, null,
    jsonb_build_object('scope', p_scope, 'count', v_count), null);
  return v_count;
end $$;

-- Fill knockout slots that come from league / group positions.
create or replace function public.assign_knockout_teams(
  p_tournament uuid, p_assignments jsonb, p_provisional boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_n integer;
  v_team uuid;
begin
  if not private.is_admin(p_tournament) then
    raise exception 'Only tournament admins can seed the knockout stage.' using errcode = '42501';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    v_team := nullif(v_item ->> 'team_id', '')::uuid;
    if v_team is not null and not exists (select 1 from public.teams where id = v_team and tournament_id = p_tournament) then
      raise exception 'Team does not belong to this tournament.';
    end if;
    if exists (select 1 from public.fixtures f where f.tournament_id = p_tournament
               and (f.home_source = v_item ->> 'source' or f.away_source = v_item ->> 'source')
               and f.status not in ('scheduled', 'postponed')) then
      raise exception 'A knockout match using % has already started.', v_item ->> 'source';
    end if;
    update public.fixtures set home_team_id = v_team
      where tournament_id = p_tournament and home_source = v_item ->> 'source';
    get diagnostics v_n = row_count; v_count := v_count + v_n;
    update public.fixtures set away_team_id = v_team
      where tournament_id = p_tournament and away_source = v_item ->> 'source';
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end loop;
  perform private.write_audit(p_tournament, case when p_provisional then 'knockout_seeded_provisionally'
                                                 else 'knockout_seeded' end,
    'fixtures', null, null, p_assignments, null);
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Results: confirm, correct, forfeit
-- ---------------------------------------------------------------------------
create or replace function private.can_confirm(f public.fixtures) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_admin(f.tournament_id)
      or (coalesce((select s.referee_can_confirm from public.tournament_settings s where s.tournament_id = f.tournament_id), false)
          and exists (select 1 from public.match_officials o
                      where o.fixture_id = f.id and o.user_id = auth.uid() and o.role = 'referee'))
$$;

-- Push the winner/loser of a confirmed match into dependent knockout fixtures.
create or replace function private.propagate_result(p_fixture uuid, p_clear boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  d public.fixtures;
  v_loser uuid;
  v_new_home uuid;
  v_new_away uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  v_loser := case when f.winner_team_id = f.home_team_id then f.away_team_id
                  when f.winner_team_id = f.away_team_id then f.home_team_id end;
  for d in select * from public.fixtures x
           where x.tournament_id = f.tournament_id
             and (x.home_source in ('winner:' || f.code, 'loser:' || f.code)
               or x.away_source in ('winner:' || f.code, 'loser:' || f.code))
           for update loop
    v_new_home := case
      when d.home_source = 'winner:' || f.code then case when p_clear then null else f.winner_team_id end
      when d.home_source = 'loser:' || f.code then case when p_clear then null else v_loser end
      else d.home_team_id end;
    v_new_away := case
      when d.away_source = 'winner:' || f.code then case when p_clear then null else f.winner_team_id end
      when d.away_source = 'loser:' || f.code then case when p_clear then null else v_loser end
      else d.away_team_id end;
    if v_new_home is distinct from d.home_team_id or v_new_away is distinct from d.away_team_id then
      if d.status not in ('scheduled', 'postponed') then
        raise exception 'Match % depends on this result and has already started. Correct match % first.', d.code, d.code
          using errcode = 'P0001';
      end if;
      update public.fixtures set home_team_id = v_new_home, away_team_id = v_new_away where id = d.id;
    end if;
  end loop;
end $$;
revoke execute on function private.propagate_result(uuid, boolean) from public, anon, authenticated;

create or replace function public.confirm_match_result(p_fixture uuid, p_note text default null)
returns public.fixtures
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_before jsonb;
  v_winner uuid;
  v_decided text;
  v_prev text;
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
    confirmed_at = now(), confirmed_by = auth.uid(),
    notes = coalesce(nullif(btrim(p_note), ''), notes)
  where id = f.id
  returning * into f;
  perform private.propagate_result(f.id, false);
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

-- Reopen a confirmed result so events can be corrected. Always audited with a reason.
create or replace function public.reopen_match_result(p_fixture uuid, p_reason text)
returns public.fixtures
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_prev text;
begin
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  if not private.is_admin(f.tournament_id) then
    raise exception 'Only tournament admins can correct confirmed results.' using errcode = '42501';
  end if;
  if f.status <> 'confirmed' then
    raise exception 'Only confirmed results need to be reopened.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for the correction (at least 5 characters).';
  end if;

  v_prev := private.enter_internal();
  perform private.propagate_result(f.id, true);
  update public.fixtures set
    status = 'completed', winner_team_id = null, confirmed_at = null, confirmed_by = null,
    decided_by = case when decided_by = 'forfeit' then 'forfeit' else null end,
    correction_count = correction_count + 1
  where id = f.id;
  perform private.exit_internal(v_prev);

  perform private.write_audit(f.tournament_id, 'result_reopened', 'fixtures', f.id,
    jsonb_build_object('home_score', f.home_score, 'away_score', f.away_score,
                       'home_penalties', f.home_penalties, 'away_penalties', f.away_penalties,
                       'winner_team_id', f.winner_team_id),
    null, btrim(p_reason));
  select * into f from public.fixtures where id = p_fixture;
  return f;
end $$;

create or replace function public.record_forfeit(p_fixture uuid, p_awarded_team uuid, p_reason text)
returns public.fixtures
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_goals integer;
  v_prev text;
begin
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  if not private.is_admin(f.tournament_id) then
    raise exception 'Only tournament admins can record a forfeit.' using errcode = '42501';
  end if;
  if f.status = 'confirmed' then
    raise exception 'Reopen the confirmed result before recording a forfeit.';
  end if;
  if p_awarded_team not in (f.home_team_id, f.away_team_id) then
    raise exception 'The awarded team must be one of the two teams in the match.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for the forfeit.';
  end if;
  select forfeit_goals into v_goals from public.tournament_settings where tournament_id = f.tournament_id;
  if v_goals is null then
    raise exception 'Set the forfeit score in tournament settings first.' using errcode = 'P0001';
  end if;

  v_prev := private.enter_internal();
  update public.fixtures set
    decided_by = 'forfeit', status = 'completed', period = 'full_time',
    home_score = case when p_awarded_team = home_team_id then v_goals else 0 end,
    away_score = case when p_awarded_team = away_team_id then v_goals else 0 end,
    home_penalties = null, away_penalties = null,
    notes = 'Forfeit: ' || btrim(p_reason)
  where id = f.id
  returning * into f;
  perform private.exit_internal(v_prev);

  perform private.write_audit(f.tournament_id, 'forfeit_recorded', 'fixtures', f.id, null,
    jsonb_build_object('awarded_team', p_awarded_team, 'home_score', f.home_score, 'away_score', f.away_score),
    btrim(p_reason));
  return f;
end $$;

-- Undo a forfeit before confirmation: scores go back to being derived from events.
create or replace function public.clear_forfeit(p_fixture uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_prev text;
begin
  select * into f from public.fixtures where id = p_fixture for update;
  if not private.is_admin(f.tournament_id) then
    raise exception 'Only tournament admins can clear a forfeit.' using errcode = '42501';
  end if;
  if f.status = 'confirmed' then
    raise exception 'Reopen the confirmed result first.';
  end if;
  v_prev := private.enter_internal();
  update public.fixtures set decided_by = null where id = f.id;
  perform private.exit_internal(v_prev);
  perform private.recompute_fixture_score(f.id);
  perform private.write_audit(f.tournament_id, 'forfeit_cleared', 'fixtures', f.id, null, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
create or replace function public.get_registration_form(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tournament_id', t.id,
    'name', t.name,
    'logo_url', t.logo_url,
    'venue', t.venue,
    'start_date', t.start_date,
    'open', t.registration_open and t.status not in ('completed', 'archived'),
    'positions', s.positions,
    'consent_text', s.registration_consent_text,
    'requires_payment', s.registration_requires_payment,
    'fee_note', s.registration_fee_note,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name) order by tm.name)
                       from public.teams tm where tm.tournament_id = t.id and not tm.is_placeholder), '[]'::jsonb)
  )
  from public.tournaments t
  join public.tournament_settings s on s.tournament_id = t.id
  where t.registration_token = p_token
$$;

create or replace function public.submit_registration(p_token uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  s public.tournament_settings;
  v_id uuid;
  v_email text := nullif(lower(btrim(p ->> 'email')), '');
  v_phone text := nullif(btrim(p ->> 'phone'), '');
  v_team uuid := nullif(p ->> 'preferred_team_id', '')::uuid;
begin
  select * into t from public.tournaments where registration_token = p_token;
  if not found then
    raise exception 'This registration link is not valid.';
  end if;
  if not t.registration_open or t.status in ('completed', 'archived') then
    raise exception 'Registration for this tournament is closed.';
  end if;
  select * into s from public.tournament_settings where tournament_id = t.id;
  if length(btrim(coalesce(p ->> 'full_name', ''))) < 2 then
    raise exception 'Enter your full name.';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Enter an email address or phone number so the organisers can contact you.';
  end if;
  if s.registration_consent_text is not null and not coalesce((p ->> 'consent_given')::boolean, false) then
    raise exception 'You must give consent to register.';
  end if;
  if v_team is not null and not exists (select 1 from public.teams where id = v_team and tournament_id = t.id) then
    v_team := null;
  end if;
  if v_email is not null and exists (select 1 from public.registrations r where r.tournament_id = t.id
                                     and lower(r.email) = v_email and r.status <> 'rejected') then
    raise exception 'A registration with this email address already exists.';
  end if;
  if (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'pending') >= 500 then
    raise exception 'Registration is temporarily unavailable. Please contact the organisers.';
  end if;

  insert into public.registrations (tournament_id, full_name, email, phone, preferred_team_id, requested_team_name,
    position, jersey_number, consent_given, consent_text, payment_option_selected, payment_status, notes)
  values (t.id, btrim(p ->> 'full_name'), v_email, v_phone, v_team,
    nullif(btrim(p ->> 'requested_team_name'), ''),
    case when (p ->> 'position') = any (s.positions) then p ->> 'position' end,
    nullif(p ->> 'jersey_number', '')::integer,
    coalesce((p ->> 'consent_given')::boolean, false),
    s.registration_consent_text,
    nullif(btrim(p ->> 'payment_option_selected'), ''),
    -- Selecting a payment option is never treated as having paid.
    (case when s.registration_requires_payment then 'unpaid' else 'not_required' end)::public.payment_status,
    nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_registration(p_registration uuid, p_team uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.registrations;
  v_player uuid;
begin
  select * into r from public.registrations where id = p_registration for update;
  if not found then
    raise exception 'Registration not found.';
  end if;
  if not private.is_admin(r.tournament_id) then
    raise exception 'Only tournament admins can approve registrations.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This registration has already been %.', r.status;
  end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and tournament_id = r.tournament_id) then
    raise exception 'Choose a team from this tournament.';
  end if;

  begin
    insert into public.players (tournament_id, team_id, full_name, position, jersey_number, registration_status,
      consent_given, consent_at, payment_status)
    values (r.tournament_id, p_team, r.full_name, r.position, r.jersey_number, 'confirmed',
      r.consent_given, case when r.consent_given then r.created_at end, r.payment_status)
    returning id into v_player;
    if r.email is not null or r.phone is not null then
      insert into public.player_contacts (player_id, tournament_id, email, phone)
      values (v_player, r.tournament_id, r.email, r.phone);
    end if;
  exception when unique_violation then
    raise exception 'A player with the same email, phone or jersey number already exists in this tournament.';
  end;

  update public.registrations set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = p_note, player_id = v_player
  where id = r.id;
  return v_player;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create or replace function public.get_invitation(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tournament_name', t.name,
    'role', i.role,
    'email', i.email,
    'expired', i.expires_at < now(),
    'accepted', i.accepted_at is not null,
    'revoked', i.revoked_at is not null
  )
  from public.tournament_invitations i
  join public.tournaments t on t.id = i.tournament_id
  where i.token = p_token
$$;

create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.tournament_invitations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept this invitation.' using errcode = '42501';
  end if;
  select * into i from public.tournament_invitations where token = p_token for update;
  if not found or i.revoked_at is not null then
    raise exception 'This invitation is not valid.';
  end if;
  if i.accepted_at is not null then
    if i.accepted_by = auth.uid() then
      return i.tournament_id;
    end if;
    raise exception 'This invitation has already been used.';
  end if;
  if i.expires_at < now() then
    raise exception 'This invitation has expired. Ask the organiser for a new one.';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  if lower(v_email) <> lower(i.email) then
    raise exception 'This invitation was sent to %. Sign in with that email address.', i.email;
  end if;

  insert into public.tournament_members (tournament_id, user_id, role, created_by)
  values (i.tournament_id, auth.uid(), i.role, i.invited_by)
  on conflict (tournament_id, user_id) do update
    set role = case when public.tournament_members.role = 'tournament_admin' then 'tournament_admin'::public.member_role
                    else excluded.role end;
  update public.tournament_invitations set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.tournament_id;
end $$;

-- ---------------------------------------------------------------------------
-- Public read-only tournament page (no private contact data)
-- ---------------------------------------------------------------------------
create or replace function public.get_public_tournament(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t public.tournaments;
  s public.tournament_settings;
begin
  select * into t from public.tournaments where slug = p_slug and public_enabled;
  if not found then
    return null;
  end if;
  select * into s from public.tournament_settings where tournament_id = t.id;
  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'description', t.description, 'logo_url', t.logo_url,
      'venue', t.venue, 'organiser', t.organiser, 'start_date', t.start_date, 'end_date', t.end_date,
      'daily_start_time', t.daily_start_time, 'daily_end_time', t.daily_end_time, 'timezone', t.timezone,
      'status', t.status, 'format', t.format, 'fixtures_published', t.fixtures_published,
      'rules_published', t.rules_published),
    'settings', jsonb_build_object(
      'points_win', s.points_win, 'points_draw', s.points_draw, 'points_loss', s.points_loss,
      'tiebreakers', s.tiebreakers, 'tiebreakers_confirmed', s.tiebreakers_confirmed,
      'fair_play_yellow', s.fair_play_yellow, 'fair_play_red', s.fair_play_red,
      'qualifiers', s.qualifiers, 'qualifiers_per_group', s.qualifiers_per_group,
      'match_duration_min', s.match_duration_min, 'double_round_robin', s.double_round_robin),
    'pitches', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.sort_order)
                         from public.pitches p where p.tournament_id = t.id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name, 'short_name', tm.short_name,
                         'colour', tm.colour, 'logo_url', tm.logo_url, 'group_label', tm.group_label) order by tm.name)
                       from public.teams tm where tm.tournament_id = t.id), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'full_name', pl.full_name,
                           'team_id', pl.team_id, 'jersey_number', pl.jersey_number))
                         from public.players pl where pl.tournament_id = t.id and pl.registration_status = 'confirmed'),
                        '[]'::jsonb),
    'fixtures', case when t.fixtures_published then coalesce((select jsonb_agg(to_jsonb(f) - 'notes' - 'referee_notes'
                         - 'confirmed_by' order by f.scheduled_date, f.scheduled_time, f.match_order)
                       from public.fixtures f where f.tournament_id = t.id), '[]'::jsonb) else '[]'::jsonb end,
    'events', case when t.fixtures_published then coalesce((select jsonb_agg(jsonb_build_object(
                         'id', e.id, 'fixture_id', e.fixture_id, 'event_type', e.event_type, 'team_id', e.team_id,
                         'player_id', e.player_id, 'assist_player_id', e.assist_player_id, 'match_second', e.match_second,
                         'created_at', e.created_at) order by e.created_at)
                       from public.match_events e where e.tournament_id = t.id
                         and e.event_type in ('goal', 'own_goal', 'penalty_goal', 'yellow_card', 'red_card',
                                              'shootout_goal', 'shootout_miss')), '[]'::jsonb) else '[]'::jsonb end,
    'rules', case when t.rules_published then coalesce((select jsonb_agg(jsonb_build_object('id', r.id,
                         'category', r.category, 'title', r.title, 'body', r.body) order by r.category, r.sort_order)
                       from public.tournament_rules r where r.tournament_id = t.id), '[]'::jsonb) else '[]'::jsonb end,
    'announcements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body,
                         'created_at', a.created_at) order by a.created_at desc)
                       from public.tournament_announcements a where a.tournament_id = t.id and a.is_published), '[]'::jsonb),
    'tiebreak_decisions', coalesce((select jsonb_agg(jsonb_build_object('scope', d.scope,
                         'ordered_team_ids', d.ordered_team_ids, 'created_at', d.created_at) order by d.created_at)
                       from public.tiebreak_decisions d where d.tournament_id = t.id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Execute grants: public RPCs only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.get_registration_form(uuid) to anon, authenticated;
grant execute on function public.submit_registration(uuid, jsonb) to anon, authenticated;
grant execute on function public.get_invitation(uuid) to anon, authenticated;
grant execute on function public.get_public_tournament(text) to anon, authenticated;
grant execute on function public.create_tournament(jsonb) to authenticated;
grant execute on function public.clone_tournament(uuid, text, date, boolean) to authenticated;
grant execute on function public.delete_tournament(uuid, text) to authenticated;
grant execute on function public.replace_fixtures(uuid, text, jsonb) to authenticated;
grant execute on function public.assign_knockout_teams(uuid, jsonb, boolean) to authenticated;
grant execute on function public.confirm_match_result(uuid, text) to authenticated;
grant execute on function public.reopen_match_result(uuid, text) to authenticated;
grant execute on function public.record_forfeit(uuid, uuid, text) to authenticated;
grant execute on function public.clear_forfeit(uuid) to authenticated;
grant execute on function public.approve_registration(uuid, uuid, text) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.set_updated_at() to authenticated;
