
-- Phase 2 protein fields
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS food_fish text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_seafood text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_milk_products text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_yogurt text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_nuts text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_meat text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_poultry text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_cheese text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_legumes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_pumpkin_seeds text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_sunflower_seeds text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_vegetables text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_veg_lettuce text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_starch text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_bread text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS food_fruit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS breakfast_protein_category text,
  ADD COLUMN IF NOT EXISTS breakfast_protein_grams numeric,
  ADD COLUMN IF NOT EXISTS breakfast_veg_grams numeric,
  ADD COLUMN IF NOT EXISTS lunch_protein_category text,
  ADD COLUMN IF NOT EXISTS lunch_protein_grams numeric,
  ADD COLUMN IF NOT EXISTS lunch_veg_grams numeric,
  ADD COLUMN IF NOT EXISTS dinner_protein_category text,
  ADD COLUMN IF NOT EXISTS dinner_protein_grams numeric,
  ADD COLUMN IF NOT EXISTS dinner_veg_grams numeric,
  ADD COLUMN IF NOT EXISTS eggs_min_per_week integer,
  ADD COLUMN IF NOT EXISTS eggs_max_per_week integer,
  ADD COLUMN IF NOT EXISTS water_target_litres numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS phase3_mb_meat text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_sprouts text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phase3_mb_veg_lettuce text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mb_pdf_path text;

-- Private storage bucket for MB PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('mb-pdfs', 'mb-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: only the practitioner who owns the client can read/write objects under clients/<client_id>/...
CREATE POLICY "Practitioners read own client mb pdfs"
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

CREATE POLICY "Practitioners upload own client mb pdfs"
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

CREATE POLICY "Practitioners update own client mb pdfs"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'mb-pdfs'
  AND (storage.foldername(name))[1] = 'clients'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.practitioner_id = auth.uid()
  )
);

CREATE POLICY "Practitioners delete own client mb pdfs"
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
