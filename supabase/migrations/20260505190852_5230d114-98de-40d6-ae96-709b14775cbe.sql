ALTER TABLE public.clients ADD COLUMN phase_new text NOT NULL DEFAULT 'phase2_strict';
UPDATE public.clients SET phase_new = CASE phase
  WHEN 1 THEN 'phase1'
  WHEN 2 THEN 'phase2_strict'
  WHEN 3 THEN 'phase3'
  ELSE 'phase2_strict'
END;
ALTER TABLE public.clients DROP COLUMN phase;
ALTER TABLE public.clients RENAME COLUMN phase_new TO phase;
ALTER TABLE public.clients ADD CONSTRAINT clients_phase_check
  CHECK (phase IN ('phase1','phase2_strict','phase2_extended','phase3','phase4'));