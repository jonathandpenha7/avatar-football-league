-- Combined Supabase setup: paste into the Supabase SQL Editor and run once.
-- Generated from supabase/migrations (apply either this file OR the migrations, not both).

-- ===== supabase/migrations/20261110000001_schema.sql =====
-- Church Tournament Manager: core schema
-- Every tournament-specific table carries tournament_id so RLS can be applied uniformly.


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.tournament_status as enum (
  'draft', 'registration_open', 'ready', 'live', 'completed', 'archived'
);

create type public.tournament_format as enum (
  'round_robin', 'single_elimination', 'double_elimination', 'group_knockout', 'league_playoff'
);

create type public.member_role as enum ('tournament_admin', 'referee', 'scorekeeper', 'viewer');

create type public.fixture_stage as enum ('league', 'group', 'knockout');

create type public.fixture_status as enum (
  'scheduled', 'in_progress', 'paused', 'completed', 'confirmed', 'postponed', 'cancelled'
);

create type public.match_period as enum (
  'not_started', 'first_half', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time'
);

create type public.event_type as enum (
  'goal', 'own_goal', 'penalty_goal', 'yellow_card', 'red_card', 'foul', 'substitution',
  'sin_bin', 'shootout_goal', 'shootout_miss', 'note'
);

create type public.rule_category as enum (
  'general', 'match', 'eligibility', 'substitution', 'fouls_cards', 'suspensions',
  'referee', 'forfeits', 'knockout'
);

create type public.registration_status as enum ('pending', 'approved', 'rejected');
create type public.player_status as enum ('pending', 'confirmed', 'withdrawn');
create type public.eligibility_status as enum ('eligible', 'ineligible');
create type public.payment_status as enum (
  'not_required', 'unpaid', 'pending_verification', 'paid', 'waived', 'refunded'
);
create type public.suspension_status as enum ('active', 'overturned');
create type public.decision_status as enum ('open', 'resolved');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  is_super_admin boolean not null default false,
  can_create_tournaments boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text check (description is null or length(description) <= 4000),
  logo_url text,
  venue text,
  organiser text,
  start_date date,
  end_date date,
  daily_start_time time,
  daily_end_time time,
  timezone text not null default 'UTC',
  status public.tournament_status not null default 'draft',
  format public.tournament_format not null default 'round_robin',
  public_enabled boolean not null default false,
  rules_published boolean not null default false,
  fixtures_published boolean not null default false,
  registration_open boolean not null default false,
  registration_token uuid not null default gen_random_uuid() unique,
  template_key text,
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournaments_dates_check check (end_date is null or start_date is null or end_date >= start_date),
  constraint tournaments_times_check check (
    daily_end_time is null or daily_start_time is null or daily_end_time > daily_start_time
  )
);
create index tournaments_status_idx on public.tournaments (status);
create trigger tournaments_updated_at before update on public.tournaments
  for each row execute function public.set_updated_at();

create table public.tournament_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);
create index tournament_members_user_idx on public.tournament_members (user_id);

create table public.tournament_invitations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid references public.profiles (id) on delete set null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);
create index tournament_invitations_tournament_idx on public.tournament_invitations (tournament_id);
create unique index tournament_invitations_open_email_key
  on public.tournament_invitations (tournament_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- One settings row per tournament. Nullable columns mean "not configured yet":
-- the application must never invent a value for them.
create table public.tournament_settings (
  tournament_id uuid primary key references public.tournaments (id) on delete cascade,
  -- Teams and squads
  team_count integer not null default 8 check (team_count between 2 and 64),
  max_squad_size integer not null default 12 check (max_squad_size between 1 and 60),
  players_on_pitch integer not null default 5 check (players_on_pitch between 1 and 11),
  substitutes integer not null default 3 check (substitutes between 0 and 30),
  min_players_to_start integer check (min_players_to_start between 1 and 11),
  positions text[] not null default array['Goalkeeper', 'Defender', 'Midfielder', 'Striker', 'All-rounder', 'Other'],
  -- Format
  double_round_robin boolean not null default false,
  qualifiers integer check (qualifiers between 2 and 64),
  third_place_match boolean not null default false,
  group_count integer check (group_count between 2 and 16),
  qualifiers_per_group integer check (qualifiers_per_group between 1 and 8),
  allow_provisional_seeding boolean not null default false,
  -- Points and tie-breakers ("points" is always the first criterion)
  points_win integer not null default 3 check (points_win between 0 and 10),
  points_draw integer not null default 1 check (points_draw between 0 and 10),
  points_loss integer not null default 0 check (points_loss between -5 and 10),
  tiebreakers text[] not null default array['goal_difference', 'goals_for', 'head_to_head'],
  tiebreakers_confirmed boolean not null default false,
  fair_play_yellow integer not null default 1 check (fair_play_yellow >= 0),
  fair_play_red integer not null default 3 check (fair_play_red >= 0),
  -- Match timing (null match_duration_min = not yet decided)
  match_duration_min integer check (match_duration_min between 1 and 240),
  periods integer not null default 2 check (periods in (1, 2)),
  half_time_min integer not null default 0 check (half_time_min between 0 and 60),
  transition_min integer check (transition_min between 0 and 120),
  extra_time_enabled boolean not null default false,
  extra_time_min integer check (extra_time_min between 1 and 60),
  penalties_enabled boolean not null default true,
  shootout_kicks integer not null default 3 check (shootout_kicks between 1 and 10),
  knockout_break_min integer not null default 0 check (knockout_break_min between 0 and 240),
  blocked_periods jsonb not null default '[]'::jsonb check (jsonb_typeof(blocked_periods) = 'array'),
  -- Officials
  referee_can_confirm boolean not null default false,
  -- Discipline (null = no automatic suspension rule configured)
  second_yellow_is_red boolean not null default true,
  red_card_suspension_matches integer check (red_card_suspension_matches between 0 and 20),
  yellow_accumulation_threshold integer check (yellow_accumulation_threshold between 2 and 20),
  yellow_accumulation_suspension_matches integer check (yellow_accumulation_suspension_matches between 1 and 20),
  -- Forfeits (null = organiser has not configured an awarded score)
  forfeit_goals integer check (forfeit_goals between 0 and 20),
  -- Registration
  registration_requires_payment boolean not null default false,
  registration_fee_note text,
  registration_consent_text text,
  updated_at timestamptz not null default now(),
  constraint settings_tiebreakers_check check (
    tiebreakers <@ array['goal_difference', 'goals_for', 'goals_against', 'wins', 'head_to_head',
                         'fair_play', 'organiser_decision', 'playoff']
  ),
  constraint settings_squad_check check (players_on_pitch <= max_squad_size)
);
create trigger tournament_settings_updated_at before update on public.tournament_settings
  for each row execute function public.set_updated_at();

create table public.pitches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  available_from time,
  available_until time,
  created_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until > available_from)
);
create unique index pitches_name_key on public.pitches (tournament_id, lower(name));

create table public.tournament_rules (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  category public.rule_category not null default 'general',
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null default '',
  sort_order integer not null default 0,
  needs_decision boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tournament_rules_tournament_idx on public.tournament_rules (tournament_id, category, sort_order);
create trigger tournament_rules_updated_at before update on public.tournament_rules
  for each row execute function public.set_updated_at();

-- Organiser checklist of open questions (e.g. unresolved rulebook items)
create table public.tournament_decisions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  key text not null,
  question text not null,
  context text,
  options text[] not null default '{}',
  status public.decision_status not null default 'open',
  resolution text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tournament_id, key),
  check (status = 'open' or resolution is not null)
);

create table public.tournament_announcements (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null default '',
  is_published boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index tournament_announcements_tournament_idx on public.tournament_announcements (tournament_id);

-- ---------------------------------------------------------------------------
-- Teams and players
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  short_name text check (short_name is null or length(short_name) <= 6),
  colour text check (colour is null or colour ~* '^#[0-9a-f]{6}$'),
  logo_url text,
  group_label text check (group_label is null or group_label ~ '^[A-Z]$'),
  seed integer check (seed is null or seed between 1 and 128),
  is_placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index teams_name_key on public.teams (tournament_id, lower(btrim(name)));
create trigger teams_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

create table public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  position text,
  jersey_number integer check (jersey_number is null or jersey_number between 0 and 999),
  is_captain boolean not null default false,
  registration_status public.player_status not null default 'confirmed',
  eligibility_status public.eligibility_status not null default 'eligible',
  eligibility_note text,
  consent_given boolean not null default false,
  consent_at timestamptz,
  payment_status public.payment_status not null default 'not_required',
  payment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index players_tournament_idx on public.players (tournament_id);
create index players_team_idx on public.players (team_id);
create unique index players_one_captain_per_team on public.players (team_id) where is_captain and team_id is not null;
create unique index players_jersey_per_team on public.players (team_id, jersey_number)
  where jersey_number is not null and team_id is not null and registration_status <> 'withdrawn';
create trigger players_updated_at before update on public.players
  for each row execute function public.set_updated_at();

-- Private contact data lives in its own table so only tournament admins can read it.
create table public.player_contacts (
  player_id uuid primary key references public.players (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or length(phone) between 5 and 30),
  updated_at timestamptz not null default now()
);
create unique index player_contacts_email_key on public.player_contacts (tournament_id, lower(email)) where email is not null;
create unique index player_contacts_phone_key on public.player_contacts (tournament_id, regexp_replace(phone, '[^0-9+]', '', 'g')) where phone is not null;
create trigger player_contacts_updated_at before update on public.player_contacts
  for each row execute function public.set_updated_at();

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or length(phone) between 5 and 30),
  preferred_team_id uuid references public.teams (id) on delete set null,
  requested_team_name text check (requested_team_name is null or length(requested_team_name) <= 80),
  position text,
  jersey_number integer check (jersey_number is null or jersey_number between 0 and 999),
  consent_given boolean not null default false,
  consent_text text,
  -- What the registrant *selected*. This is never treated as proof of payment.
  payment_option_selected text,
  payment_status public.payment_status not null default 'unpaid',
  notes text check (notes is null or length(notes) <= 1000),
  status public.registration_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  player_id uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now()
);
create index registrations_tournament_idx on public.registrations (tournament_id, status);

-- ---------------------------------------------------------------------------
-- Fixtures and match data
-- ---------------------------------------------------------------------------
create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9-]{1,24}$'),
  stage public.fixture_stage not null default 'league',
  round_number integer not null default 1,
  round_name text,
  group_label text,
  match_order integer not null default 0,
  home_team_id uuid references public.teams (id),
  away_team_id uuid references public.teams (id),
  -- Where a knockout participant comes from: 'league:1', 'group:A:2', 'seed:3',
  -- 'winner:SF1', 'loser:WB1-2'. Null for fixed league fixtures.
  home_source text,
  away_source text,
  pitch_id uuid references public.pitches (id) on delete set null,
  scheduled_date date,
  scheduled_time time,
  duration_min integer check (duration_min is null or duration_min between 1 and 240),
  status public.fixture_status not null default 'scheduled',
  period public.match_period not null default 'not_started',
  timer_started_at timestamptz,
  timer_elapsed_sec integer not null default 0 check (timer_elapsed_sec >= 0),
  home_score integer not null default 0 check (home_score >= 0),
  away_score integer not null default 0 check (away_score >= 0),
  home_penalties integer check (home_penalties >= 0),
  away_penalties integer check (away_penalties >= 0),
  decided_by text check (decided_by in ('normal', 'penalties', 'forfeit')),
  winner_team_id uuid references public.teams (id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  correction_count integer not null default 0,
  notes text,
  referee_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, code),
  check (home_team_id is null or away_team_id is null or home_team_id <> away_team_id),
  check (status <> 'confirmed' or (home_team_id is not null and away_team_id is not null))
);
create index fixtures_schedule_idx on public.fixtures (tournament_id, scheduled_date, scheduled_time);
create index fixtures_home_source_idx on public.fixtures (tournament_id, home_source);
create index fixtures_away_source_idx on public.fixtures (tournament_id, away_source);
create index fixtures_home_team_idx on public.fixtures (home_team_id);
create index fixtures_away_team_idx on public.fixtures (away_team_id);
create trigger fixtures_updated_at before update on public.fixtures
  for each row execute function public.set_updated_at();

create table public.match_officials (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  fixture_id uuid not null references public.fixtures (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null check (role in ('referee', 'scorekeeper')),
  created_at timestamptz not null default now(),
  unique (fixture_id, user_id, role)
);
create index match_officials_user_idx on public.match_officials (user_id);
create index match_officials_fixture_idx on public.match_officials (fixture_id);

create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  fixture_id uuid not null references public.fixtures (id) on delete cascade,
  event_type public.event_type not null,
  -- team_id is the team the player belongs to (for own goals the *other* team is credited).
  team_id uuid references public.teams (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  assist_player_id uuid references public.players (id) on delete set null,
  -- substitution: player coming off
  related_player_id uuid references public.players (id) on delete set null,
  match_second integer check (match_second is null or match_second >= 0),
  period public.match_period,
  duration_min integer check (duration_min is null or duration_min between 1 and 30),
  detail text check (detail is null or length(detail) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (event_type = 'note' or team_id is not null)
);
create index match_events_fixture_idx on public.match_events (fixture_id, created_at);
create index match_events_player_idx on public.match_events (player_id);
create index match_events_tournament_type_idx on public.match_events (tournament_id, event_type);

-- ---------------------------------------------------------------------------
-- Discipline
-- ---------------------------------------------------------------------------
create table public.disciplinary_records (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid references public.players (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  fixture_id uuid references public.fixtures (id) on delete cascade,
  match_event_id uuid unique references public.match_events (id) on delete cascade,
  incident_type text not null check (incident_type in
    ('yellow_card', 'second_yellow', 'red_card', 'sin_bin', 'misconduct', 'other')),
  card_type text not null default 'none' check (card_type in ('yellow', 'red', 'none')),
  reason text,
  referee_id uuid references public.profiles (id) on delete set null,
  occurred_at timestamptz not null default now(),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index disciplinary_records_tournament_idx on public.disciplinary_records (tournament_id, player_id);

create table public.suspensions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  disciplinary_record_id uuid references public.disciplinary_records (id) on delete cascade,
  -- Matches are counted from the first team fixture *after* this one.
  starts_after_fixture_id uuid references public.fixtures (id) on delete set null,
  matches integer not null check (matches between 1 and 20),
  reason text not null,
  source text not null default 'manual' check (source in ('automatic', 'manual')),
  status public.suspension_status not null default 'active',
  status_note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index suspensions_tournament_idx on public.suspensions (tournament_id, player_id);

-- Organiser decisions that resolve ties the configured criteria could not separate.
create table public.tiebreak_decisions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  scope text not null default 'league', -- 'league' or 'group:A'
  ordered_team_ids uuid[] not null check (cardinality(ordered_team_ids) >= 2),
  note text not null,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index tiebreak_decisions_tournament_idx on public.tiebreak_decisions (tournament_id);

-- ---------------------------------------------------------------------------
-- Audit log (written only by security-definer triggers / functions)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  -- Deliberately no foreign key: the audit trail outlives deleted tournaments.
  tournament_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_logs_tournament_idx on public.audit_logs (tournament_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- ===== supabase/migrations/20261110000002_functions_triggers.sql =====
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

-- ===== supabase/migrations/20261110000003_rls.sql =====
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

-- ===== supabase/migrations/20261110000004_rpc.sql =====
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

-- ===== supabase/migrations/20261110000005_storage_realtime.sql =====
-- Storage bucket for tournament and team logos, plus realtime publication.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tournament-assets', 'tournament-assets', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'])
on conflict (id) do nothing;

-- Files are stored as <tournament_id>/<filename>; only that tournament's admins may write.
create policy "tournament assets are public" on storage.objects for select
  using (bucket_id = 'tournament-assets');

create policy "tournament admins upload assets" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tournament-assets'
    and private.is_admin(nullif((storage.foldername(name))[1], '')::uuid)
  );

create policy "tournament admins update assets" on storage.objects for update to authenticated
  using (bucket_id = 'tournament-assets' and private.is_admin(nullif((storage.foldername(name))[1], '')::uuid));

create policy "tournament admins delete assets" on storage.objects for delete to authenticated
  using (bucket_id = 'tournament-assets' and private.is_admin(nullif((storage.foldername(name))[1], '')::uuid));

-- Live updates for match centre and public pages (RLS still applies to realtime).
alter publication supabase_realtime add table public.fixtures, public.match_events;
alter table public.fixtures replica identity full;
alter table public.match_events replica identity full;
