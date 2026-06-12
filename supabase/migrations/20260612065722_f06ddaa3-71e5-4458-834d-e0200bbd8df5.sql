ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
ALTER TABLE public.clients REPLICA IDENTITY FULL;