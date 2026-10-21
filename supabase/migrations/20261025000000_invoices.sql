-- TASK 48 : registre des factures clients (export Odoo « Pièces comptables ») pour le CA du jour, du mois et de l'annee,
-- les encaissements et les creances.
-- Table reservee au backend (cle service) : RLS activee sans politique pour les roles API, comme expenses.
-- L'acces est controle par l'application (session, hotel, permission finance.manage).
-- Le numero de facture N'EST PAS unique : l'export Odoo d'Anjary contient 2 163 numeros utilises deux fois par deux factures
-- differentes (clients, dates et montants differents). La cle d'idempotence est donc numero + client + date + montant (hachee).
-- Un nouvel import met a jour l'etat de paiement d'une facture deja connue (Non paye -> Paye) sans creer de doublon.

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'odoo' CHECK (source IN ('odoo')),
  invoice_number text,
  partner_name text NOT NULL,
  invoice_date date NOT NULL,
  due_date date,
  payment_terms text,
  amount_ttc numeric(14,2) NOT NULL CHECK (amount_ttc > 0),
  payment_status text NOT NULL CHECK (payment_status IN ('unpaid','in_payment','partial','paid','reversed')),
  payment_date date,
  imported_by uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_hotel_idempotency_key UNIQUE (hotel_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS invoices_hotel_date_idx ON public.invoices (hotel_id, invoice_date);
CREATE INDEX IF NOT EXISTS invoices_hotel_payment_date_idx ON public.invoices (hotel_id, payment_date) WHERE payment_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_hotel_open_idx ON public.invoices (hotel_id) WHERE payment_status IN ('unpaid','partial');
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON public.invoices (tenant_id);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.invoices TO service_role;
