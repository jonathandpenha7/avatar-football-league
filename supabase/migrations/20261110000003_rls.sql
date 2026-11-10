-- Row Level Security. Permissions are enforced here, not only in the UI.
--
-- Role summary (per tournament, via tournament_members):
--   tournament_admin : manage everything in the tournament
--   referee          : read tournament; record events/status for assigned matches
--   scorekeeper      : read tournament; record events/status for assigned matches
--   viewer           : read-only
-- Super Admins (profiles.is_super_admin) can do everything.
-- Anonymous visitors can read a curated subset of public tournaments.

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.tournaments, public.teams, public.pitches, public.fixtures,
  public.match_events, public.tournament_rules, public.tournament_announcements to anon;
grant usage, select on all sequences in schema public to authenticated;

-- Columns clients must never write directly.
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.disciplinary_records from anon;

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.tournament_invitations enable row level security;
alter table public.tournament_settings enable row level security;
alter table public.pitches enable row level security;
alter table public.tournament_rules enable row level security;
alter table public.tournament_decisions enable row level security;
alter table public.tournament_announcements enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.player_contacts enable row level security;
alter table public.registrations enable row level security;
alter table public.fixtures enable row level security;
alter table public.match_officials enable row level security;
alter table public.match_events enable row level security;
alter table public.disciplinary_records enable row level security;
alter table public.suspensions enable row level security;
alter table public.tiebreak_decisions enable row level security;
alter table public.audit_logs enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or private.is_super_admin()
  or exists (
    select 1 from public.tournament_members mine
    join public.tournament_members theirs on theirs.tournament_id = mine.tournament_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or private.is_super_admin())
  with check (id = auth.uid() or private.is_super_admin());

-- tournaments ---------------------------------------------------------------
create policy tournaments_select on public.tournaments for select to authenticated
  using (private.is_member(id) or public_enabled);
create policy tournaments_select_anon on public.tournaments for select to anon
  using (public_enabled);
-- Creation goes through create_tournament(); direct inserts are limited to
-- users the platform allows to create tournaments.
create policy tournaments_insert on public.tournaments for insert to authenticated
  with check (
    private.is_super_admin()
    or coalesce((select p.can_create_tournaments from public.profiles p where p.id = auth.uid()), false)
  );
create policy tournaments_update on public.tournaments for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));
create policy tournaments_delete on public.tournaments for delete to authenticated
  using (private.is_super_admin());

-- tournament_members --------------------------------------------------------
create policy members_select on public.tournament_members for select to authenticated
  using (private.is_member(tournament_id));
create policy members_insert on public.tournament_members for insert to authenticated
  with check (private.is_admin(tournament_id));
create policy members_update on public.tournament_members for update to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));
create policy members_delete on public.tournament_members for delete to authenticated
  using (private.is_admin(tournament_id) or user_id = auth.uid());

-- tournament_invitations ----------------------------------------------------
create policy invitations_admin on public.tournament_invitations for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

-- Admin-managed configuration tables (members read, admins write) ------------
create policy settings_select on public.tournament_settings for select to authenticated
  using (private.is_member(tournament_id));
create policy settings_write on public.tournament_settings for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy pitches_select on public.pitches for select to authenticated
  using (private.is_member(tournament_id) or private.is_public(tournament_id));
create policy pitches_select_anon on public.pitches for select to anon
  using (private.is_public(tournament_id));
create policy pitches_write on public.pitches for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy rules_select on public.tournament_rules for select to authenticated
  using (private.is_member(tournament_id)
         or (private.is_public(tournament_id)
             and (select t.rules_published from public.tournaments t where t.id = tournament_id)));
create policy rules_select_anon on public.tournament_rules for select to anon
  using (private.is_public(tournament_id)
         and (select t.rules_published from public.tournaments t where t.id = tournament_id));
create policy rules_write on public.tournament_rules for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy decisions_select on public.tournament_decisions for select to authenticated
  using (private.is_member(tournament_id));
create policy decisions_write on public.tournament_decisions for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy announcements_select on public.tournament_announcements for select to authenticated
  using (private.is_member(tournament_id) or (is_published and private.is_public(tournament_id)));
create policy announcements_select_anon on public.tournament_announcements for select to anon
  using (is_published and private.is_public(tournament_id));
create policy announcements_write on public.tournament_announcements for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

-- teams ---------------------------------------------------------------------
create policy teams_select on public.teams for select to authenticated
  using (private.is_member(tournament_id) or private.is_public(tournament_id));
create policy teams_select_anon on public.teams for select to anon
  using (private.is_public(tournament_id));
create policy teams_write on public.teams for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

-- players (no contact data here; public pages use get_public_tournament) ------
create policy players_select on public.players for select to authenticated
  using (private.is_member(tournament_id));
create policy players_write on public.players for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy player_contacts_admin on public.player_contacts for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

-- registrations (public submissions use submit_registration()) ----------------
create policy registrations_admin on public.registrations for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

-- fixtures ------------------------------------------------------------------
create policy fixtures_select on public.fixtures for select to authenticated
  using (private.is_member(tournament_id) or private.fixtures_public(tournament_id));
create policy fixtures_select_anon on public.fixtures for select to anon
  using (private.fixtures_public(tournament_id));
create policy fixtures_insert on public.fixtures for insert to authenticated
  with check (private.is_admin(tournament_id));
-- Officials may update their assigned fixtures; the guard trigger limits them
-- to status, timer and notes columns.
create policy fixtures_update on public.fixtures for update to authenticated
  using (private.is_admin(tournament_id) or private.is_fixture_official(id))
  with check (private.is_admin(tournament_id) or private.is_fixture_official(id));
create policy fixtures_delete on public.fixtures for delete to authenticated
  using (private.is_admin(tournament_id));

-- match officials -----------------------------------------------------------
create policy officials_select on public.match_officials for select to authenticated
  using (private.is_member(tournament_id));
create policy officials_write on public.match_officials for all to authenticated
  using (private.is_admin(tournament_id))
  with check (
    private.is_admin(tournament_id)
    and exists (select 1 from public.fixtures f where f.id = fixture_id and f.tournament_id = match_officials.tournament_id)
    and exists (select 1 from public.tournament_members m
                where m.tournament_id = match_officials.tournament_id and m.user_id = match_officials.user_id
                  and m.role in ('tournament_admin', 'referee', 'scorekeeper'))
  );

-- match events --------------------------------------------------------------
create policy events_select on public.match_events for select to authenticated
  using (private.is_member(tournament_id) or private.fixtures_public(tournament_id));
create policy events_select_anon on public.match_events for select to anon
  using (private.fixtures_public(tournament_id));
create policy events_insert on public.match_events for insert to authenticated
  with check (private.can_score_fixture(fixture_id));
create policy events_update on public.match_events for update to authenticated
  using (private.can_score_fixture(fixture_id)) with check (private.can_score_fixture(fixture_id));
create policy events_delete on public.match_events for delete to authenticated
  using (private.can_score_fixture(fixture_id));

-- discipline ----------------------------------------------------------------
create policy discipline_select on public.disciplinary_records for select to authenticated
  using (private.is_member(tournament_id));
create policy discipline_write on public.disciplinary_records for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy suspensions_select on public.suspensions for select to authenticated
  using (private.is_member(tournament_id));
create policy suspensions_write on public.suspensions for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

create policy tiebreak_select on public.tiebreak_decisions for select to authenticated
  using (private.is_member(tournament_id));
create policy tiebreak_write on public.tiebreak_decisions for all to authenticated
  using (private.is_admin(tournament_id)) with check (private.is_admin(tournament_id));

-- audit logs (read-only; written by security-definer code) -----------------
create policy audit_select on public.audit_logs for select to authenticated
  using (
    private.is_super_admin()
    or (tournament_id is not null and private.is_admin(tournament_id))
  );
