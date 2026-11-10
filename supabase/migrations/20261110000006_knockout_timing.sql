-- Knockout matches (semi-finals, third place, final) can have their own length.
-- Null means "same as league matches".
alter table public.tournament_settings
  add column knockout_match_duration_min integer check (knockout_match_duration_min between 1 and 240),
  add column knockout_half_time_min integer check (knockout_half_time_min between 0 and 60);
