-- TASK 46 : module depenses (journalieres et mensuelles) pour suivre la situation de l'hotel et calculer GOP, GOPPAR et CPOR.
-- Table reservee au backend (cle service) : RLS activee sans politique pour les roles API, comme audit_alert_notifications.
-- L'acces est controle par l'application (session, hotel, permissions expenses.manage / expenses.approve).

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  expense_date date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'personnel','energy','laundry','supplies','food','maintenance','commissions',
    'office','telecom','insurance','taxes','bank_fees','other')),
  description text,
  supplier text,
  document_number text,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','mobile_money','transfer','cheque','card')),
  amount_ttc numeric(14,2) NOT NULL CHECK (amount_ttc > 0),
  vat_deductible numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_deductible >= 0),
  amount_ht numeric(14,2) GENERATED ALWAYS AS (amount_ttc - vat_deductible) STORED,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_vat_not_above_total CHECK (vat_deductible <= amount_ttc),
  CONSTRAINT expenses_hotel_idempotency_key UNIQUE (hotel_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS expenses_hotel_date_idx ON public.expenses (hotel_id, expense_date);
CREATE INDEX IF NOT EXISTS expenses_tenant_idx ON public.expenses (tenant_id);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expenses FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.expenses TO service_role;

-- Permissions : saisie pour le Night Audit ; validation reservee aux detenteurs de expenses.approve (OWNER et GM via admin.full).
INSERT INTO public.permissions (code, name)
SELECT v.code, v.name FROM (VALUES
  ('expenses.manage', 'Manage Expenses'),
  ('expenses.approve', 'Approve Expenses')) AS v(code, name)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = v.code);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code = 'NIGHT_AUDIT' AND p.code = 'expenses.manage'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
