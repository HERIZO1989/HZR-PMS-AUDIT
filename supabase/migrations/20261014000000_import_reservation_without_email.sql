-- TASK 32 : import de reservations sans adresse e-mail (export Odoo reel d'Anjary : le client n'est identifie que par son nom).
-- Avant : l'e-mail etait obligatoire, donc 100 % des lignes d'un export Odoo etaient rejetees.
-- Sans e-mail, on rattache la reservation au client de meme nom (prenom + nom, sans e-mail) deja present, sinon on le cree sans e-mail.
-- Avec e-mail, la recherche ignore maintenant la casse, comme l'index unique guests_tenant_email_unique (lower(email)).
DO $patch$
DECLARE
  d text;
  old_block text := E'      SELECT g.id INTO v_guest_id FROM public.guests g\n      WHERE g.tenant_id = v_tenant_id AND g.email = v_data->>''guest_email'' LIMIT 1;\n';
  new_block text := E'      IF v_data->>''guest_email'' IS NOT NULL THEN\n        SELECT g.id INTO v_guest_id FROM public.guests g\n        WHERE g.tenant_id = v_tenant_id AND lower(g.email) = lower(v_data->>''guest_email'') LIMIT 1;\n      ELSE\n        SELECT g.id INTO v_guest_id FROM public.guests g\n        WHERE g.tenant_id = v_tenant_id AND g.email IS NULL\n          AND lower(g.first_name) = lower(COALESCE(v_data->>''guest_first_name'', ''Guest''))\n          AND lower(g.last_name) = lower(COALESCE(v_data->>''guest_last_name'', ''Import''))\n        ORDER BY g.created_at LIMIT 1;\n      END IF;\n';
BEGIN
  d := pg_get_functiondef('public.apply_import_row'::regproc);
  IF position('g.email IS NULL' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position(old_block IN d) = 0 THEN
    RAISE EXCEPTION 'apply_import_row : bloc de recherche du client introuvable, patch annule';
  END IF;
  EXECUTE replace(d, old_block, new_block);
END
$patch$;

-- La recherche d'un client sans e-mail se fait par (tenant, prenom, nom) : sans index, chaque ligne importee relisait toute la table
-- (mesure sur 4 391 lignes : 14 s sans index, 2 s avec).
CREATE INDEX IF NOT EXISTS guests_tenant_name_noemail_idx
  ON public.guests (tenant_id, lower(first_name), lower(last_name))
  WHERE email IS NULL;
