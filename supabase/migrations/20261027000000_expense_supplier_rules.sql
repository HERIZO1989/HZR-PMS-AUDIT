-- TASK 52 : classer les depenses par fournisseur depuis l'ecran Depenses.
-- Une regle fournisseur -> categorie est memorisee : elle reclasse les depenses deja importees et s'applique aux prochains imports.
-- Aucune fonction existante n'est modifiee. Table reservee au backend (cle service), RLS activee sans politique.

CREATE TABLE IF NOT EXISTS public.expense_supplier_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  supplier_key text NOT NULL,
  supplier_label text NOT NULL,
  category text NOT NULL CHECK (category IN ('personnel','energy','laundry','supplies','food','maintenance','commissions','office','telecom','insurance','taxes','bank_fees','other')),
  created_by uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_supplier_rules_hotel_key UNIQUE (hotel_id, supplier_key)
);

ALTER TABLE public.expense_supplier_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_supplier_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.expense_supplier_rules TO service_role;

-- Memorise la regle et reclasse, en une seule transaction, toutes les depenses du fournisseur (libelles bruts fournis par l'application,
-- qui normalise les noms elle-meme). Retourne le nombre de depenses dont la categorie a change.
CREATE OR REPLACE FUNCTION public.reclassify_supplier_expenses(
  p_hotel_id uuid, p_supplier_key text, p_supplier_label text, p_raw_suppliers text[], p_category text,
  p_staff_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_rule_id uuid;
  v_changed integer;
BEGIN
  IF p_category NOT IN ('personnel','energy','laundry','supplies','food','maintenance','commissions','office','telecom','insurance','taxes','bank_fees','other') THEN
    RAISE EXCEPTION 'Categorie invalide: %', p_category;
  END IF;
  IF p_supplier_key IS NULL OR btrim(p_supplier_key) = '' THEN
    RAISE EXCEPTION 'Fournisseur requis';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.hotels WHERE id = p_hotel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hotel introuvable';
  END IF;

  INSERT INTO public.expense_supplier_rules(tenant_id, hotel_id, supplier_key, supplier_label, category, created_by)
  VALUES (v_tenant, p_hotel_id, p_supplier_key, left(p_supplier_label, 120), p_category, p_staff_user_id)
  ON CONFLICT (hotel_id, supplier_key) DO UPDATE
    SET category = EXCLUDED.category, supplier_label = EXCLUDED.supplier_label, updated_at = now()
  RETURNING id INTO v_rule_id;

  UPDATE public.expenses
    SET category = p_category, updated_at = now()
    WHERE hotel_id = p_hotel_id AND supplier = ANY (p_raw_suppliers) AND category <> p_category;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  PERFORM public.log_audit_event(v_tenant, p_hotel_id, p_staff_user_id, 'expense','reclassify','expense_supplier_rule', v_rule_id,
    jsonb_build_object('supplier', p_supplier_label, 'category', p_category, 'expenses_changed', v_changed));
  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION public.reclassify_supplier_expenses(uuid,text,text,text[],text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_supplier_expenses(uuid,text,text,text[],text,uuid) TO service_role;
