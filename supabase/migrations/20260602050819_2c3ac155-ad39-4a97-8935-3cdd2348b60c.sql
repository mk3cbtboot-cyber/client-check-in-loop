
-- Storage RLS policies for mb-pdfs bucket
-- Path convention: clients/<client_id>/<filename>

DROP POLICY IF EXISTS "Practitioners upload MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners read MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners update MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners delete MB PDFs for own clients" ON storage.objects;

CREATE POLICY "Practitioners upload MB PDFs for own clients"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(name))[1] = 'clients'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners read MB PDFs for own clients"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(name))[1] = 'clients'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners update MB PDFs for own clients"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(name))[1] = 'clients'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.practitioner_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(name))[1] = 'clients'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners delete MB PDFs for own clients"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(name))[1] = 'clients'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.practitioner_id = auth.uid()
  )
);
