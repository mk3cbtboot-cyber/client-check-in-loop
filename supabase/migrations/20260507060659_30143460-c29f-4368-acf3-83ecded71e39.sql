ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS general_wellbeing integer,
  ADD COLUMN IF NOT EXISTS fatigue integer,
  ADD COLUMN IF NOT EXISTS sleep integer,
  ADD COLUMN IF NOT EXISTS headache integer,
  ADD COLUMN IF NOT EXISTS pain integer,
  ADD COLUMN IF NOT EXISTS joint_pain integer,
  ADD COLUMN IF NOT EXISTS acid_reflux integer,
  ADD COLUMN IF NOT EXISTS digestion integer,
  ADD COLUMN IF NOT EXISTS allergy_skin integer,
  ALTER COLUMN feeling DROP NOT NULL,
  ALTER COLUMN water_glasses DROP NOT NULL;