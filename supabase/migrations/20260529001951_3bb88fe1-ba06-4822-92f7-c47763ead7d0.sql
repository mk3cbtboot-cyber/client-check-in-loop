CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('client','practitioner','ai')),
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_client_created ON public.messages(client_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners manage own client messages"
ON public.messages
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.practitioner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.practitioner_id = auth.uid()));