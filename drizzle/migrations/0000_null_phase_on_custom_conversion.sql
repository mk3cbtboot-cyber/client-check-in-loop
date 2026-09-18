CREATE OR REPLACE FUNCTION public.sync_client_type_system_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- If client_type changed, mirror to system_mode
  IF NEW.client_type IS DISTINCT FROM OLD.client_type OR TG_OP = 'INSERT' THEN
    NEW.system_mode := CASE WHEN NEW.client_type = 'custom' THEN 'own_practice' ELSE 'mb' END;
  END IF;
  -- If system_mode changed (legacy code path), mirror to client_type
  IF (TG_OP = 'UPDATE' AND NEW.system_mode IS DISTINCT FROM OLD.system_mode) THEN
    NEW.client_type := CASE WHEN NEW.system_mode = 'own_practice' THEN 'custom' ELSE 'mb' END;
  END IF;

  -- Custom Rx clients must never carry a phase value, including on conversion.
  IF NEW.client_type = 'custom' OR NEW.system_mode = 'own_practice' THEN
    NEW.phase := NULL;
  END IF;

  RETURN NEW;
END;
$function$;