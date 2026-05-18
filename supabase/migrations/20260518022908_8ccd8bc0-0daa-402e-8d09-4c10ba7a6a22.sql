
-- Ensure one role per user
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.ctid < b.ctid AND a.user_id = b.user_id AND a.role = b.role;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_key;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- Update handle_new_user to assign role based on clients table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.clients WHERE lower(email) = lower(NEW.email)) THEN
    _role := 'client';
  ELSE
    _role := 'practitioner';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Allow clients to read their own client row (by matching email)
DROP POLICY IF EXISTS "Clients view own record" ON public.clients;
CREATE POLICY "Clients view own record"
ON public.clients
FOR SELECT
TO authenticated
USING (
  lower(email) = lower((SELECT email FROM public.profiles WHERE id = auth.uid()))
);
