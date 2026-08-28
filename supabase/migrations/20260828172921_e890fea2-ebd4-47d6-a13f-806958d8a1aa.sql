ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS plan_instructions_acked_hash text,
  ADD COLUMN IF NOT EXISTS plan_instructions_acked_at timestamptz;