
-- Add client_type and plan_format columns
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'mb',
  ADD COLUMN IF NOT EXISTS plan_format text NOT NULL DEFAULT 'food_list';

-- Backfill from existing system_mode
UPDATE public.clients
SET client_type = CASE WHEN system_mode = 'own_practice' THEN 'custom' ELSE 'mb' END;

-- Keep system_mode and client_type in sync via trigger so legacy code keeps working
CREATE OR REPLACE FUNCTION public.sync_client_type_system_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- If client_type changed, mirror to system_mode
  IF NEW.client_type IS DISTINCT FROM OLD.client_type OR TG_OP = 'INSERT' THEN
    NEW.system_mode := CASE WHEN NEW.client_type = 'custom' THEN 'own_practice' ELSE 'mb' END;
  END IF;
  -- If system_mode changed (legacy code path), mirror to client_type
  IF (TG_OP = 'UPDATE' AND NEW.system_mode IS DISTINCT FROM OLD.system_mode) THEN
    NEW.client_type := CASE WHEN NEW.system_mode = 'own_practice' THEN 'custom' ELSE 'mb' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_sync_client_type ON public.clients;
CREATE TRIGGER clients_sync_client_type
BEFORE INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.sync_client_type_system_mode();
