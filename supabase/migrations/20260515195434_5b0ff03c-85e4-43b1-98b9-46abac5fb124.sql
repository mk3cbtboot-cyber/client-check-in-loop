ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phase3_mode text NOT NULL DEFAULT 'practitioner_custom',
  ADD COLUMN IF NOT EXISTS phase3_mb_fish text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_seafood text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_cheese text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_legumes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_vegetables text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_fat_oil text NOT NULL DEFAULT '';