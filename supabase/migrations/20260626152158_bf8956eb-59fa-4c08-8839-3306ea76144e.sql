ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS age integer,
  ADD COLUMN IF NOT EXISTS activity_level text,
  ADD COLUMN IF NOT EXISTS macro_goal text,
  ADD COLUMN IF NOT EXISTS macros jsonb,
  ADD COLUMN IF NOT EXISTS macros_adjusted jsonb,
  ADD COLUMN IF NOT EXISTS macros_shared boolean NOT NULL DEFAULT false;