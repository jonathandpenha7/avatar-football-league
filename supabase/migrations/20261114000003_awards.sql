-- Tournament awards (Winners, Runners up, MVP, Most Goals), MVP nominations,
-- finalisation, and awards/breaks on the public page.

create table public.tournament_awards (
  tournament_id uuid primary key references public.tournaments (id) on delete cascade,
  champion_team_id uuid references public.teams (id) on delete set null,
  runner_up_team_id uuid references public.teams (id) on delete set null,
  third_place_team_id uuid references public.teams (id) on delete set null,
  mvp_player_id uuid references public.players (id) on delete set null,
  mvp_reason text check (mvp_reason is null or length(mvp_reason) <= 2000),
  mvp_comments text check (mvp_comments is null or length(mvp_comments) <= 2000),
  top_scorer_player_ids uuid[] not null default '{}',
  top_scorer_goals integer check (top_scorer_goals is null or top_scorer_goals >= 0),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  published boolean not null default false,
  finalised_at timestamptz,
  finalised_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not published or confirmed_at is not null),
  check (finalised_at is null or confirmed_at is not null),
  check (mvp_player_id is null or mvp_reason is not null)
);
create trigger tournament_awards_updated_at before update on public.tournament_awards
  for each row execute function public.set_updated_at();

create or replace function private.guard_awards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if private.is_internal() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.finalised_at is not null then raise exception 'Awards are finalised and cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.finalised_at is not null then
    raise exception 'The tournament is finalised. Reopen it before changing awards.' using errcode = 'P0001';
  end if;
  if new.finalised_at is not null then
    raise exception 'Use the finalise action to finalise the tournament.' using errcode = 'P0001';
  end if;
  if new.mvp_player_id is not null
     and (select p.tournament_id from public.players p where p.id = new.mvp_player_id) is distinct from new.tournament_id then
    raise exception 'The MVP must be a player in this tournament.';
  end if;
  return new;
end $$;
create trigger tournament_awards_guard before insert or update or delete on public.tournament_awards
  for each row execute function private.guard_awards();
create trigger audit_tournament_awards after insert or update or delete on public.tournament_awards
  for each row execute function private.audit_trigger('tournament_id');

create table public.mvp_nominations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  nominated_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text check (reason is null or length(reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (tournament_id, nominated_by, player_id)
);
create index mvp_nominations_tournament_idx on public.mvp_nominations (tournament_id, player_id);

create or replace function private.validate_nomination() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select p.tournament_id from public.players p where p.id = new.player_id) is distinct from new.tournament_id then
    raise exception 'The nominated player is not in this tournament.';
  end if;
  if exists (select 1 from public.tournament_awards a where a.tournament_id = new.tournament_id and a.finalised_at is not null) then
    raise exception 'The tournament is finalised. Nominations are closed.';
  end if;
  return new;
end $$;
create trigger mvp_nominations_validate before insert or update on public.mvp_nominations
  for each row execute function private.validate_nomination();

-- Finalise (lock awards, mark tournament completed) or reopen with a reason.
create or replace function public.set_tournament_finalised(p_tournament uuid, p_finalise boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.tournament_awards;
  v_prev text;
begin
  if not private.is_admin(p_tournament) then
    raise exception 'Only tournament admins can finalise the tournament.' using errcode = '42501';
  end if;
  select * into a from public.tournament_awards where tournament_id = p_tournament for update;
  if p_finalise then
    if a.confirmed_at is null then
      raise exception 'Review and confirm the awards before finalising.';
    end if;
    if exists (select 1 from public.fixtures f where f.tournament_id = p_tournament
               and f.status in ('scheduled', 'in_progress', 'paused', 'completed')) then
      raise exception 'Some matches are not finished and confirmed. Confirm, cancel or abandon them first.';
    end if;
  elsif length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for reopening the tournament.';
  end if;
  v_prev := private.enter_internal();
  update public.tournament_awards
    set finalised_at = case when p_finalise then now() end,
        finalised_by = case when p_finalise then auth.uid() end
    where tournament_id = p_tournament;
  update public.tournaments set status = case when p_finalise then 'completed'::public.tournament_status else 'live'::public.tournament_status end
    where id = p_tournament;
  perform private.exit_internal(v_prev);
  perform private.write_audit(p_tournament, case when p_finalise then 'tournament_finalised' else 'tournament_reopened' end,
    'tournament_awards', p_tournament, null, null, nullif(btrim(coalesce(p_reason, '')), ''));
end $$;

alter table public.tournament_awards enable row level security;
alter table public.mvp_nominations enable row level security;
grant select, insert, update, delete on public.tournament_awards, public.mvp_nominations to authenticated;
grant select on public.tournament_awards to anon;

create policy awards_select on public.tournament_awards for select to authenticated
  using (private.is_member(tournament_id) or (published and private.is_public(tournament_id)));
create policy awards_select_anon on public.tournament_awards for select to anon
  using (published and private.is_public(tournament_id));
create policy awards_write on public.tournament_awards for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy nominations_select on public.mvp_nominations for select to authenticated
  using (private.is_member(tournament_id));
create policy nominations_insert on public.mvp_nominations for insert to authenticated
  with check (
    nominated_by = auth.uid()
    and (private.is_admin(tournament_id)
         or (coalesce((select s.mvp_nominations_enabled from public.tournament_settings s where s.tournament_id = mvp_nominations.tournament_id), false)
             and private.member_role(tournament_id) in ('referee', 'scorekeeper')))
  );
create policy nominations_delete on public.mvp_nominations for delete to authenticated
  using (nominated_by = auth.uid() or private.is_admin(tournament_id));

grant execute on function public.set_tournament_finalised(uuid, boolean, text) to authenticated;
revoke execute on function public.set_tournament_finalised(uuid, boolean, text) from public, anon;

-- Public page: published awards and the schedule's breaks.
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
    'fixtures', case when t.fixtures_published then coalesce((select jsonb_agg(to_jsonb(f) - 'notes' - 'referee_notes' - 'submitted_by'
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
                       from public.tiebreak_decisions d where d.tournament_id = t.id), '[]'::jsonb),
    'breaks', s.blocked_periods,
    'knockout_break_min', s.knockout_break_min,
    'awards', (select jsonb_build_object(
                 'champion_team_id', a.champion_team_id, 'runner_up_team_id', a.runner_up_team_id,
                 'third_place_team_id', a.third_place_team_id, 'mvp_player_id', a.mvp_player_id,
                 'mvp_reason', a.mvp_reason, 'top_scorer_player_ids', a.top_scorer_player_ids,
                 'top_scorer_goals', a.top_scorer_goals, 'finalised', a.finalised_at is not null)
               from public.tournament_awards a where a.tournament_id = t.id and a.published)
  );
end $$;
grant execute on function public.get_public_tournament(text) to anon, authenticated;
