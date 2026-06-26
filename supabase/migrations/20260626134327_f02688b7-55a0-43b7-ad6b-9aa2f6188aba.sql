ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS keys_to_success text,
  ADD COLUMN IF NOT EXISTS digestion_protocol text,
  ADD COLUMN IF NOT EXISTS recommended_supplements text;