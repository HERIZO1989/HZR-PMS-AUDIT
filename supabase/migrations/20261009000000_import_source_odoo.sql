-- TASK 22 : autorise la source "odoo" dans import_batches.
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_source_system_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_source_system_check
  CHECK (source_system = ANY (ARRAY['opera','protel','odoo','fidelio','generic_csv','generic_xlsx','generic_txt']));
