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
