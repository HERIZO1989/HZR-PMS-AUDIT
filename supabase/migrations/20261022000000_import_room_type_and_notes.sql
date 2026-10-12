-- TASK 39 : l'import transmet le type de chambre et une note a la reservation creee.
-- Utilise par le decodage des chambres a partir du tarif (rateDecoder.ts) : une ligne de 2 chambres devient 2 reservations avec leur type,
-- et une note « [Import Odoo] ... a verifier » quand la lecture est ambigue ou hors grille.
-- room_type_id n'est retenu que s'il appartient bien a l'hotel du lot (jamais un type d'un autre hotel).
DO $patch$
DECLARE
  d text;
  cols_old text := E'total_amount, currency_code, stay_type\n      ) VALUES (';
  cols_new text := E'total_amount, currency_code, stay_type, room_type_id, special_requests\n      ) VALUES (';
  vals_old text := E'COALESCE(v_data->>''stay_type'', ''overnight'')\n      )\n      RETURNING id INTO v_res_id;';
  vals_new text := E'COALESCE(v_data->>''stay_type'', ''overnight''),\n        (SELECT rt.id FROM public.room_types rt WHERE rt.hotel_id = v_hotel_id AND rt.id::text = v_data->>''room_type_id''),\n        NULLIF(btrim(v_data->>''special_requests''), '''')\n      )\n      RETURNING id INTO v_res_id;';
BEGIN
  d := pg_get_functiondef('public.apply_import_row'::regproc);
  IF position('special_requests' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position(cols_old IN d) = 0 OR position(vals_old IN d) = 0 THEN
    RAISE EXCEPTION 'apply_import_row : marqueurs introuvables, patch annule';
  END IF;
  EXECUTE replace(replace(d, cols_old, cols_new), vals_old, vals_new);
END
$patch$;
