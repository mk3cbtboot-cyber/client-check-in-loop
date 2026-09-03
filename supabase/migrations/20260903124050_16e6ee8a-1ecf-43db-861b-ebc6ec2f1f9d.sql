ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS recipes_client_active_idx ON public.recipes (client_id, created_at DESC) WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS "Practitioners delete recipes for own clients" ON public.recipes;

REVOKE DELETE ON public.recipes FROM authenticated;