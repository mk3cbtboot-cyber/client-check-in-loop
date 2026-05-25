ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS practitioner_tier text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_practitioner_tier_check CHECK (practitioner_tier IS NULL OR practitioner_tier IN ('metabolic_rx','practitioner_rx','custom_rx'));

-- Allow practitioners to update their own profile (needed to set/change tier)
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);