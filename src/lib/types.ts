import type { MemberRole } from "./permissions";
import type { Tiebreaker, TournamentFormat } from "./engine/types";

export type TournamentStatus = "draft" | "registration_open" | "ready" | "live" | "completed" | "archived";
export type FixtureStatus = "scheduled" | "in_progress" | "paused" | "completed" | "confirmed" | "postponed" | "cancelled";
export type MatchPeriod = "not_started" | "first_half" | "half_time" | "second_half" | "extra_time" | "penalties" | "full_time";
export type EventType =
  | "goal" | "own_goal" | "penalty_goal" | "yellow_card" | "red_card" | "foul"
  | "substitution" | "sin_bin" | "shootout_goal" | "shootout_miss" | "note";
export type RuleCategory =
  | "general" | "match" | "eligibility" | "substitution" | "fouls_cards" | "suspensions" | "referee" | "forfeits" | "knockout";
export type PaymentStatus = "not_required" | "unpaid" | "pending_verification" | "paid" | "waived" | "refunded";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
  can_create_tournaments: boolean;
  created_at: string;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  venue: string | null;
  organiser: string | null;
  start_date: string | null;
  end_date: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  timezone: string;
  status: TournamentStatus;
  format: TournamentFormat;
  public_enabled: boolean;
  rules_published: boolean;
  fixtures_published: boolean;
  registration_open: boolean;
  registration_token: string;
  template_key: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlockedPeriodRow {
  date?: string | null;
  start: string; // HH:MM
  end: string;
  pitch_id?: string | null;
  label?: string | null;
}

export interface TournamentSettings {
  tournament_id: string;
  team_count: number;
  max_squad_size: number;
  players_on_pitch: number;
  substitutes: number;
  min_players_to_start: number | null;
  positions: string[];
  double_round_robin: boolean;
  qualifiers: number | null;
  third_place_match: boolean;
  group_count: number | null;
  qualifiers_per_group: number | null;
  allow_provisional_seeding: boolean;
  points_win: number;
  points_draw: number;
  points_loss: number;
  tiebreakers: Tiebreaker[];
  tiebreakers_confirmed: boolean;
  fair_play_yellow: number;
  fair_play_red: number;
  match_duration_min: number | null;
  periods: 1 | 2;
  half_time_min: number;
  transition_min: number | null;
  extra_time_enabled: boolean;
  extra_time_min: number | null;
  penalties_enabled: boolean;
  shootout_kicks: number;
  knockout_break_min: number;
  blocked_periods: BlockedPeriodRow[];
  referee_can_confirm: boolean;
  second_yellow_is_red: boolean;
  red_card_suspension_matches: number | null;
  yellow_accumulation_threshold: number | null;
  yellow_accumulation_suspension_matches: number | null;
  forfeit_goals: number | null;
  registration_requires_payment: boolean;
  registration_fee_note: string | null;
  registration_consent_text: string | null;
}

export interface Pitch {
  id: string;
  tournament_id: string;
  name: string;
  sort_order: number;
  available_from: string | null;
  available_until: string | null;
}

export interface Team {
  id: string;
  tournament_id: string;
  name: string;
  short_name: string | null;
  colour: string | null;
  logo_url: string | null;
  group_label: string | null;
  seed: number | null;
  is_placeholder: boolean;
  created_at: string;
}

export interface Player {
  id: string;
  tournament_id: string;
  team_id: string | null;
  full_name: string;
  position: string | null;
  jersey_number: number | null;
  is_captain: boolean;
  registration_status: "pending" | "confirmed" | "withdrawn";
  eligibility_status: "eligible" | "ineligible";
  eligibility_note: string | null;
  consent_given: boolean;
  payment_status: PaymentStatus;
  payment_note: string | null;
  created_at: string;
}

export interface PlayerContact {
  player_id: string;
  email: string | null;
  phone: string | null;
}

export interface Registration {
  id: string;
  tournament_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_team_id: string | null;
  requested_team_name: string | null;
  position: string | null;
  jersey_number: number | null;
  consent_given: boolean;
  payment_option_selected: string | null;
  payment_status: PaymentStatus;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  player_id: string | null;
  created_at: string;
}

export interface Fixture {
  id: string;
  tournament_id: string;
  code: string;
  stage: "league" | "group" | "knockout";
  round_number: number;
  round_name: string | null;
  group_label: string | null;
  match_order: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_source: string | null;
  away_source: string | null;
  pitch_id: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  duration_min: number | null;
  status: FixtureStatus;
  period: MatchPeriod;
  timer_started_at: string | null;
  timer_elapsed_sec: number;
  home_score: number;
  away_score: number;
  home_penalties: number | null;
  away_penalties: number | null;
  decided_by: "normal" | "penalties" | "forfeit" | null;
  winner_team_id: string | null;
  confirmed_at: string | null;
  correction_count: number;
  notes: string | null;
  referee_notes: string | null;
  updated_at: string;
}

export interface MatchEvent {
  id: string;
  tournament_id: string;
  fixture_id: string;
  event_type: EventType;
  team_id: string | null;
  player_id: string | null;
  assist_player_id: string | null;
  related_player_id: string | null;
  match_second: number | null;
  period: MatchPeriod | null;
  duration_min: number | null;
  detail: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MatchOfficial {
  id: string;
  fixture_id: string;
  user_id: string;
  role: "referee" | "scorekeeper";
}

export interface Member {
  id: string;
  tournament_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  profile?: Pick<Profile, "id" | "email" | "full_name"> | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: MemberRole;
  token: string;
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface Rule {
  id: string;
  tournament_id: string;
  category: RuleCategory;
  title: string;
  body: string;
  sort_order: number;
  needs_decision: boolean;
  updated_at: string;
}

export interface Decision {
  id: string;
  tournament_id: string;
  key: string;
  question: string;
  context: string | null;
  options: string[];
  status: "open" | "resolved";
  resolution: string | null;
  resolved_at: string | null;
  sort_order: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  is_published: boolean;
  created_at: string;
}

export interface DisciplinaryRecord {
  id: string;
  player_id: string | null;
  team_id: string | null;
  fixture_id: string | null;
  match_event_id: string | null;
  incident_type: "yellow_card" | "second_yellow" | "red_card" | "sin_bin" | "misconduct" | "other";
  card_type: "yellow" | "red" | "none";
  reason: string | null;
  referee_id: string | null;
  occurred_at: string;
  notes: string | null;
}

export interface Suspension {
  id: string;
  player_id: string;
  team_id: string | null;
  disciplinary_record_id: string | null;
  starts_after_fixture_id: string | null;
  matches: number;
  reason: string;
  source: "automatic" | "manual";
  status: "active" | "overturned";
  status_note: string | null;
  created_at: string;
}

export interface TiebreakDecisionRow {
  id: string;
  scope: string;
  ordered_team_ids: string[];
  note: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  tournament_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
