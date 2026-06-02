# MB PDF Parser

Parse a client's MB meal plan PDF and populate their food data in Supabase, with a practitioner review step before save.

## 1. Database / storage

New migration:

- Add columns to `public.clients`:
  - Phase 2 proteins: `food_fish`, `food_seafood`, `food_milk_products`, `food_yogurt`, `food_nuts`, `food_meat`, `food_poultry`, `food_cheese`, `food_legumes`, `food_pumpkin_seeds`, `food_sunflower_seeds` (text, default `''`)
  - Phase 2 carbs: `food_vegetables`, `food_veg_lettuce`, `food_starch`, `food_bread`, `food_fruit` (text, default `''`)
  - Meal plan grams (per meal): `breakfast_protein_category`, `breakfast_protein_grams`, `breakfast_veg_grams`, and the same for `lunch_*` and `dinner_*`
  - Limits: `eggs_min_per_week` (int), `eggs_max_per_week` (int), `water_target_litres` (numeric, default 2.5)
  - New Phase 3 fields: `phase3_mb_meat`, `phase3_mb_sprouts`, `phase3_mb_veg_lettuce` (text, default `''`)
  - `mb_pdf_path` (text) — storage object path of the uploaded PDF
- Create private storage bucket `mb-pdfs` with RLS so a practitioner can read/write only files under `clients/<client_id>/...` for clients they own.

## 2. Edge function: `parse-mb-pdf`

- Input: `{ clientId, storagePath }`. Verifies the caller is the client's practitioner.
- Downloads the PDF from `mb-pdfs` using the service-role client.
- Extracts text using `unpdf` (`npm:unpdf`) — pure JS, works in Deno edge runtime.
- Anchors used to slice the document:
  - `Personal Food List - Protein`
  - `Personal Food List - Carbohydrates`
  - `Additional Information about the Meal Plan`
  - `$$CA_PHASE3$$`
  - `Extended personal Food List`
- Parses:
  - Meal table (page before the food list): regex per meal column for protein category + grams and Vegetable/Veg.Lettuce grams.
  - Phase 2 protein/carb categories: split section by known category labels, capture food items until the next label.
  - Egg limits: regex like `(\d+)\s*-\s*(\d+)\s*eggs?\s*per week` (with min/max variants).
  - Water: regex matching `(\d+(?:\s*[½¼¾]|\.\d+)?)\s*l(?:iters|itres)?` and normalises `½/¼/¾`.
  - Phase 3 extended list: same category-split approach, mapped to `phase3_mb_*`.
- Returns a structured JSON object with each field plus a per-field `extracted: boolean` flag so the UI can mark unextracted fields.
- Does **not** write to `clients` — review/save is a separate step done from the client.

## 3. Practitioner UI (client profile page in `src/pages/Dashboard.tsx`)

New component `src/components/MbPdfImport.tsx`:

- "Upload MB PDF" button → file input (PDF only).
- On select: uploads to `mb-pdfs/clients/<clientId>/<timestamp>.pdf`, then invokes `parse-mb-pdf`.
- Shows a review modal/sheet with all extracted fields grouped:
  - Meal plan grams (3 meal cards)
  - Phase 2 — Proteins
  - Phase 2 — Carbohydrates
  - Additional info (eggs min/max, water litres)
  - Phase 3 extended list
- Every field is editable (text inputs for comma-separated lists, number inputs for grams/eggs/water).
- Fields flagged as unextracted render with a warning style and a "Not extracted — please fill in" hint.
- Footer buttons: **Re-upload** (resets, opens file picker again) and **Confirm and Save** (writes all fields to `clients` row, sets `mb_pdf_path`, closes modal, refreshes dashboard data).

Wire the button into the existing client profile/expanded card area in `Dashboard.tsx`.

## 4. Out of scope

- No changes to other features (messaging, office hours, HUD).
- AI interceptor integration with the stored PDF will be wired up in a later task — this task only stores the PDF path.

## Technical notes

- `unpdf` is used in the edge function because it has no native deps and runs in Deno; PDF text comes back per-page which is enough for the anchor-based parser.
- All grams/eggs/water values are coerced to numbers in the review step before save; blank = `null`.
- Storage path is saved in `clients.mb_pdf_path` so later features can fetch the same PDF.
- Frontend uses the existing `supabase` client; edge function uses `verify_jwt = false` plus an in-function auth check (same pattern as `client-messages`), and is added to `supabase/config.toml`.
