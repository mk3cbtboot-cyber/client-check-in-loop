ALTER TABLE public.profiles ALTER COLUMN last_name SET DEFAULT '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email, last_name)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'last_name', ''))
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