
-- Add fields for weekly Phase 2 Strict check-in
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS phase2_strict_started_at timestamptz;

-- For existing phase2_strict clients without a start date, set to created_at
UPDATE public.clients
  SET phase2_strict_started_at = created_at
  WHERE phase = 'phase2_strict' AND phase2_strict_started_at IS NULL;

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS body_fat_pct numeric,
  ADD COLUMN IF NOT EXISTS waist_cm numeric,
  ADD COLUMN IF NOT EXISTS hip_cm numeric,
  ADD COLUMN IF NOT EXISTS upper_thigh_cm numeric,
  ADD COLUMN IF NOT EXISTS is_weekly boolean NOT NULL DEFAULT false;
