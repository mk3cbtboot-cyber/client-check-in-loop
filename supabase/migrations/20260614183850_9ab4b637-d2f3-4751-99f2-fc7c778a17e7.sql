
ALTER TABLE public.weekly_meal_plans
  ADD COLUMN IF NOT EXISTS breakfast_batch_start_date date,
  ADD COLUMN IF NOT EXISTS lunch_batch_start_date date,
  ADD COLUMN IF NOT EXISTS dinner_batch_start_date date,
  ADD COLUMN IF NOT EXISTS breakfast_batch_start_date_alt date,
  ADD COLUMN IF NOT EXISTS lunch_batch_start_date_alt date,
  ADD COLUMN IF NOT EXISTS dinner_batch_start_date_alt date;
