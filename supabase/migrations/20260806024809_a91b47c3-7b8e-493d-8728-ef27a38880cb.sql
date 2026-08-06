ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS food_list_notes_stale jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.flag_stale_food_list_notes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  slot text;
  slots text[] := ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner'];
  old_sig text;
  new_sig text;
  new_note text;
  old_note text;
  result jsonb;
BEGIN
  result := COALESCE(NEW.food_list_notes_stale, '{}'::jsonb);

  FOREACH slot IN ARRAY slots LOOP
    SELECT COALESCE(string_agg(concat_ws('|', e->>'name', e->>'portion', e->>'category'), ';'), '')
      INTO old_sig
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(COALESCE(OLD.food_list, '{}'::jsonb) -> slot) = 'array'
             THEN COALESCE(OLD.food_list, '{}'::jsonb) -> slot ELSE '[]'::jsonb END) AS e;

    SELECT COALESCE(string_agg(concat_ws('|', e->>'name', e->>'portion', e->>'category'), ';'), '')
      INTO new_sig
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(COALESCE(NEW.food_list, '{}'::jsonb) -> slot) = 'array'
             THEN COALESCE(NEW.food_list, '{}'::jsonb) -> slot ELSE '[]'::jsonb END) AS e;

    new_note := COALESCE(NEW.food_list_notes ->> slot, '');
    old_note := COALESCE(OLD.food_list_notes ->> slot, '');

    IF old_sig IS DISTINCT FROM new_sig AND btrim(new_note) <> '' THEN
      result := jsonb_set(result, ARRAY[slot], 'true'::jsonb, true);
    END IF;

    -- Practitioner edited (or emptied) the note: review done, clear the flag.
    IF new_note IS DISTINCT FROM old_note OR btrim(new_note) = '' THEN
      result := jsonb_set(result, ARRAY[slot], 'false'::jsonb, true);
    END IF;
  END LOOP;

  NEW.food_list_notes_stale := result;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_flag_stale_food_list_notes ON public.clients;
CREATE TRIGGER clients_flag_stale_food_list_notes
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.flag_stale_food_list_notes();