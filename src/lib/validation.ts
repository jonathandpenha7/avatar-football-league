import { z } from "zod";

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM");
const optionalTime = z.union([time, z.literal("")]).optional().nullable().transform((v) => (v ? v : null));
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optionalText = (max: number) =>
  z.string().max(max).optional().nullable().transform((v) => (v && v.trim() ? v.trim() : null));
const optionalInt = (min: number, max: number) =>
  z.union([z.number().int().min(min).max(max), z.nan(), z.null(), z.undefined()]).transform((v) =>
    typeof v === "number" && !Number.isNaN(v) ? v : null,
  );

export const TIEBREAKERS = [
  "goal_difference",
  "goals_for",
  "goals_against",
  "wins",
  "head_to_head",
  "fair_play",
  "organiser_decision",
  "playoff",
] as const;

export const FORMATS = ["round_robin", "league_playoff", "single_elimination", "double_elimination", "group_knockout"] as const;
export const STATUSES = ["draft", "registration_open", "ready", "live", "completed", "archived"] as const;

export const blockedPeriodSchema = z
  .object({
    date: optionalDate,
    start: time,
    end: time,
    pitch_id: z.string().uuid().optional().nullable(),
    label: optionalText(80),
    description: optionalText(300),
  })
  .refine((b) => b.end > b.start, "Blocked period must end after it starts");

export const generalSchema = z
  .object({
    name: z.string().trim().min(2, "Enter at least 2 characters").max(120),
    description: optionalText(4000),
    venue: optionalText(200),
    organiser: optionalText(200),
    start_date: optionalDate,
    end_date: optionalDate,
    daily_start_time: optionalTime,
    daily_end_time: optionalTime,
    timezone: z.string().min(1).max(64),
    status: z.enum(STATUSES),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  })
  .refine((v) => !v.daily_start_time || !v.daily_end_time || v.daily_end_time > v.daily_start_time, {
    message: "End time must be after start time",
    path: ["daily_end_time"],
  });

export const settingsSchema = z
  .object({
    team_count: z.number().int().min(2).max(64),
    max_squad_size: z.number().int().min(1).max(60),
    players_on_pitch: z.number().int().min(1).max(11),
    substitutes: z.number().int().min(0).max(30),
    min_players_to_start: optionalInt(1, 11),
    positions: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
    double_round_robin: z.boolean(),
    qualifiers: optionalInt(2, 64),
    third_place_match: z.boolean(),
    group_count: optionalInt(2, 16),
    qualifiers_per_group: optionalInt(1, 8),
    allow_provisional_seeding: z.boolean(),
    points_win: z.number().int().min(0).max(10),
    points_draw: z.number().int().min(0).max(10),
    points_loss: z.number().int().min(-5).max(10),
    tiebreakers: z.array(z.enum(TIEBREAKERS)).max(8),
    tiebreakers_confirmed: z.boolean(),
    fair_play_yellow: z.number().int().min(0).max(20),
    fair_play_red: z.number().int().min(0).max(20),
    match_duration_min: optionalInt(1, 240),
    periods: z.union([z.literal(1), z.literal(2)]),
    half_time_min: z.number().int().min(0).max(60),
    knockout_match_duration_min: optionalInt(1, 240),
    knockout_half_time_min: optionalInt(0, 60),
    max_substitutions: optionalInt(0, 50),
    mvp_nominations_enabled: z.boolean(),
    transition_min: optionalInt(0, 120),
    extra_time_enabled: z.boolean(),
    extra_time_min: optionalInt(1, 60),
    penalties_enabled: z.boolean(),
    shootout_kicks: z.number().int().min(1).max(10),
    knockout_break_min: z.number().int().min(0).max(240),
    blocked_periods: z.array(blockedPeriodSchema).max(20),
    referee_can_confirm: z.boolean(),
    second_yellow_is_red: z.boolean(),
    red_card_suspension_matches: optionalInt(0, 20),
    yellow_accumulation_threshold: optionalInt(2, 20),
    yellow_accumulation_suspension_matches: optionalInt(1, 20),
    forfeit_goals: optionalInt(0, 20),
    registration_requires_payment: z.boolean(),
    registration_fee_note: optionalText(500),
    registration_consent_text: optionalText(2000),
  })
  .refine((s) => s.players_on_pitch <= s.max_squad_size, {
    message: "Players on the pitch cannot exceed the maximum squad size",
    path: ["players_on_pitch"],
  })
  .refine((s) => new Set(s.tiebreakers).size === s.tiebreakers.length, {
    message: "Each tie-breaker can only be used once",
    path: ["tiebreakers"],
  })
  .refine((s) => !s.yellow_accumulation_threshold || s.yellow_accumulation_suspension_matches, {
    message: "Set how many matches a yellow-card accumulation suspension lasts",
    path: ["yellow_accumulation_suspension_matches"],
  });

export type SettingsInput = z.input<typeof settingsSchema>;

export const pitchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  available_from: optionalTime,
  available_until: optionalTime,
});

export const createTournamentSchema = z.object({
  general: generalSchema,
  format: z.enum(FORMATS),
  settings: settingsSchema,
  pitches: z.array(pitchSchema).min(1, "Add at least one pitch").max(20),
  teamNames: z.array(z.string().trim().min(1).max(80)).max(64),
  templateKey: z.string().optional().nullable(),
});

export const teamSchema = z.object({
  name: z.string().trim().min(1, "Enter a team name").max(80),
  short_name: optionalText(6),
  colour: z
    .union([z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #22c55e"), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null)),
  group_label: z
    .union([z.string().regex(/^[A-P]$/), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  seed: optionalInt(1, 128),
});

export const playerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the player's full name").max(120),
  team_id: z.string().uuid().nullable(),
  position: optionalText(40),
  jersey_number: optionalInt(0, 999),
  is_captain: z.boolean(),
  registration_status: z.enum(["pending", "confirmed", "withdrawn"]),
  eligibility_status: z.enum(["eligible", "ineligible"]),
  eligibility_note: optionalText(300),
  consent_given: z.boolean(),
  payment_status: z.enum(["not_required", "unpaid", "pending_verification", "paid", "waived", "refunded"]),
  payment_note: optionalText(300),
  email: z
    .union([z.string().trim().email("Enter a valid email"), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(30),
});

export type PlayerInput = z.input<typeof playerSchema>;

export const registrationSubmitSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).optional(),
  phone: z.string().trim().max(30).optional(),
  preferred_team_id: z.string().optional(),
  requested_team_name: z.string().trim().max(80).optional(),
  position: z.string().max(40).optional(),
  jersey_number: z.string().regex(/^\d{0,3}$/, "Numbers only").optional(),
  consent_given: z.boolean(),
  payment_option_selected: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
});

export const eventSchema = z.object({
  fixture_id: z.string().uuid(),
  event_type: z.enum([
    "goal", "own_goal", "penalty_goal", "yellow_card", "red_card", "foul",
    "substitution", "sin_bin", "shootout_goal", "shootout_miss", "note",
  ]),
  team_id: z.string().uuid().nullable(),
  player_id: z.string().uuid().nullable().optional(),
  assist_player_id: z.string().uuid().nullable().optional(),
  related_player_id: z.string().uuid().nullable().optional(),
  match_second: z.number().int().min(0).max(86_400).nullable().optional(),
  period: z.string().nullable().optional(),
  duration_min: z.number().int().min(1).max(30).nullable().optional(),
  detail: z.string().max(1000).nullable().optional(),
});

export const ruleSchema = z.object({
  category: z.enum(["general", "match", "eligibility", "substitution", "fouls_cards", "suspensions", "referee", "forfeits", "knockout"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(10_000),
  needs_decision: z.boolean(),
});

export const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email").transform((v) => v.toLowerCase()),
  role: z.enum(["tournament_admin", "referee", "scorekeeper", "viewer"]),
});
