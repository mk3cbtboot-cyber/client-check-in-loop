DROP POLICY IF EXISTS "Practitioners upload MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners read MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners update MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners delete MB PDFs for own clients" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners upload own client mb pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners read own client mb pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners update own client mb pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Practitioners delete own client mb pdfs" ON storage.objects;

CREATE POLICY "Practitioners upload MB PDFs for own clients"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(storage.objects.name))[1] = 'clients'
  AND (storage.foldername(storage.objects.name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id::text = (storage.foldername(storage.objects.name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners read MB PDFs for own clients"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(storage.objects.name))[1] = 'clients'
  AND (storage.foldername(storage.objects.name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id::text = (storage.foldername(storage.objects.name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners update MB PDFs for own clients"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(storage.objects.name))[1] = 'clients'
  AND (storage.foldername(storage.objects.name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id::text = (storage.foldername(storage.objects.name))[2]
      AND c.practitioner_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(storage.objects.name))[1] = 'clients'
  AND (storage.foldername(storage.objects.name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id::text = (storage.foldername(storage.objects.name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners delete MB PDFs for own clients"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(storage.objects.name))[1] = 'clients'
  AND (storage.foldername(storage.objects.name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id::text = (storage.foldername(storage.objects.name))[2]
      AND c.practitioner_id = auth.uid()
  )
);