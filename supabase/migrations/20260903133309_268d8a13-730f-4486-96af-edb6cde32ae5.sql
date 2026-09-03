DROP POLICY IF EXISTS "Practitioners manage own clients" ON public.clients;

CREATE POLICY "Practitioners can view own clients"
  ON public.clients FOR SELECT TO authenticated
  USING (practitioner_id = auth.uid());

CREATE POLICY "Practitioners can create own clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (practitioner_id = auth.uid());

CREATE POLICY "Practitioners can update own clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (practitioner_id = auth.uid())
  WITH CHECK (practitioner_id = auth.uid());

REVOKE DELETE ON public.clients FROM authenticated;
REVOKE DELETE ON public.clients FROM anon;