-- Matches can be abandoned (e.g. weather, injury). Kept in its own migration
-- because a new enum value must be committed before it is used.
alter type public.fixture_status add value if not exists 'abandoned';
