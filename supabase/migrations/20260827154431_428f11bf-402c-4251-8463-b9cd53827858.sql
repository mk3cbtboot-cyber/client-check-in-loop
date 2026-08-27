ALTER TABLE public.mb_cap_ledger
  ADD COLUMN status text NOT NULL DEFAULT 'planned',
  ADD COLUMN source text NOT NULL DEFAULT 'run',
  ADD COLUMN logged_at timestamptz,
  ADD COLUMN recipe_id uuid;

ALTER TABLE public.mb_cap_ledger
  ADD CONSTRAINT mb_cap_ledger_status_check CHECK (status IN ('planned', 'eaten', 'skipped')),
  ADD CONSTRAINT mb_cap_ledger_source_check CHECK (source IN ('run', 'log'));

CREATE INDEX idx_mb_cap_ledger_client_week ON public.mb_cap_ledger (client_id, week_start);