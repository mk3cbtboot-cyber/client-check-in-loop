ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS food_list jsonb NOT NULL DEFAULT '{"breakfast":[],"lunch":[],"dinner":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS food_list_notes jsonb NOT NULL DEFAULT '{"breakfast":"","lunch":"","dinner":""}'::jsonb;