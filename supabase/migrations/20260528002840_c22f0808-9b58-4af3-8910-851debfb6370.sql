ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS idx_clients_archived_at ON public.clients(archived_at);