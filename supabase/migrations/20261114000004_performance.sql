-- Performance: telemetry table, a missing index and a single-pass score
-- recalculation. No data is changed.

-- ---------------------------------------------------------------------------
-- Telemetry (timings only; no names, contact details or tokens)
-- ---------------------------------------------------------------------------
create table public.perf_events (
  id bigint generated always as identity primary key,
  tournament_id uuid,
  user_id uuid default auth.uid(),
  kind text not null check (kind in ('event_save', 'event_retry', 'timer_action', 'realtime_event_delivery',
                                     'realtime_fixture_delivery', 'realtime_reconnect', 'request_failed',
                                     'page_web_vital', 'js_error')),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000),
  ok boolean not null default true,
  path text check (path is null or length(path) <= 200),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 2000),
  created_at timestamptz not null default now()
);
create index perf_events_tournament_idx on public.perf_events (tournament_id, created_at desc);
create index perf_events_created_idx on public.perf_events (created_at desc);

alter table public.perf_events enable row level security;
grant select, insert on public.perf_events to authenticated;
grant usage, select on sequence public.perf_events_id_seq to authenticated;
create policy perf_insert on public.perf_events for insert to authenticated
  with check (user_id = auth.uid() and (tournament_id is null or private.is_member(tournament_id)));
create policy perf_select on public.perf_events for select to authenticated
  using (private.is_super_admin() or (tournament_id is not null and private.is_admin(tournament_id)));

-- ---------------------------------------------------------------------------
-- Missing index (match_officials was scanned sequentially by tournament).
-- Writes to this table are rare (assignments), so the cost is negligible.
-- ---------------------------------------------------------------------------
create index if not exists match_officials_tournament_idx on public.match_officials (tournament_id);

-- ---------------------------------------------------------------------------
-- Score recalculation in one pass over the match's events (was four counts).
-- Same rules: goals and penalty goals for the scorer's team, own goals for the
-- other team, shootout kicks separate, forfeits untouched.
-- ---------------------------------------------------------------------------
create or replace function private.recompute_fixture_score(p_fixture uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  v_prev text;
  v_home integer;
  v_away integer;
  v_home_pens integer;
  v_away_pens integer;
  v_shootout boolean;
begin
  select * into f from public.fixtures where id = p_fixture;
  if not found or f.decided_by = 'forfeit' then
    return;
  end if;
  select
    count(*) filter (where (e.event_type in ('goal', 'penalty_goal') and e.team_id = f.home_team_id)
                        or (e.event_type = 'own_goal' and e.team_id = f.away_team_id)),
    count(*) filter (where (e.event_type in ('goal', 'penalty_goal') and e.team_id = f.away_team_id)
                        or (e.event_type = 'own_goal' and e.team_id = f.home_team_id)),
    count(*) filter (where e.event_type = 'shootout_goal' and e.team_id = f.home_team_id),
    count(*) filter (where e.event_type = 'shootout_goal' and e.team_id = f.away_team_id),
    bool_or(e.event_type in ('shootout_goal', 'shootout_miss'))
  into v_home, v_away, v_home_pens, v_away_pens, v_shootout
  from public.match_events e
  where e.fixture_id = f.id;

  -- Skip the write (and its realtime message) when nothing changed, e.g. a foul.
  if v_home = f.home_score and v_away = f.away_score
     and (case when coalesce(v_shootout, false) then v_home_pens end) is not distinct from f.home_penalties
     and (case when coalesce(v_shootout, false) then v_away_pens end) is not distinct from f.away_penalties then
    return;
  end if;

  v_prev := private.enter_internal();
  update public.fixtures x set
    home_score = v_home,
    away_score = v_away,
    home_penalties = case when coalesce(v_shootout, false) then v_home_pens end,
    away_penalties = case when coalesce(v_shootout, false) then v_away_pens end
  where x.id = f.id;
  perform private.exit_internal(v_prev);
end $$;
revoke execute on function private.recompute_fixture_score(uuid) from public, anon, authenticated;
