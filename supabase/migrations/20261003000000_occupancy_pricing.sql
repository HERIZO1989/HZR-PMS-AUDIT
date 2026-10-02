-- TASK 17 - Capacite et tarification par occupation dans create_reservation.
--
-- * room_types : extra_adult_fee et extra_child_fee (supplements par personne et par nuit, 0 par defaut :
--   aucun changement de prix tant qu'ils ne sont pas configures).
-- * create_reservation :
--   - refuse adults < 1 et adults + children > room_types.max_occupancy ;
--   - supplement par nuit = adultes au-dela de base_occupancy x extra_adult_fee
--     + enfants au-dela des places restantes de la base x extra_child_fee.
-- Patch par remplacement de texte sur la definition courante (signature inchangee, pas de surcharge).

ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS extra_adult_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_adult_fee >= 0),
  ADD COLUMN IF NOT EXISTS extra_child_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_child_fee >= 0);

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.create_reservation(uuid,uuid,uuid,date,date,uuid,text,text,text,uuid,integer,integer,text,uuid,text,uuid)'::regprocedure);
  IF position('Capacite et supplements' IN v_def) > 0 THEN
    RAISE EXCEPTION 'create_reservation gere deja la capacite';
  END IF;

  v_new := replace(v_def, E'  v_res public.reservations;\n',
    E'  v_res public.reservations;\n  v_base_occ int;\n  v_max_occ int;\n  v_extra_adult_fee numeric;\n  v_extra_child_fee numeric;\n  v_extra_per_night numeric;\n');

  v_new := replace(v_new,
    E'  SELECT base_rate INTO v_base_rate FROM public.room_types\n  WHERE id = p_room_type_id AND hotel_id = p_hotel_id;',
    E'  SELECT base_rate, base_occupancy, max_occupancy, extra_adult_fee, extra_child_fee\n    INTO v_base_rate, v_base_occ, v_max_occ, v_extra_adult_fee, v_extra_child_fee\n  FROM public.room_types\n  WHERE id = p_room_type_id AND hotel_id = p_hotel_id;');

  v_new := replace(v_new,
    E'  v_total := round(v_total, 2);',
    E'  -- Capacite et supplements par occupation\n  IF COALESCE(p_adults, 0) < 1 THEN\n    RAISE EXCEPTION ''Au moins 1 adulte est requis'';\n  END IF;\n  IF p_adults + COALESCE(p_children, 0) > v_max_occ THEN\n    RAISE EXCEPTION ''Capacite maximale de % personnes depassee pour ce type de chambre'', v_max_occ;\n  END IF;\n  v_extra_per_night := greatest(p_adults - v_base_occ, 0) * v_extra_adult_fee\n    + greatest(COALESCE(p_children, 0) - greatest(v_base_occ - p_adults, 0), 0) * v_extra_child_fee;\n  v_total := round(v_total + v_nights * v_extra_per_night, 2);');

  IF v_new = v_def OR position('Capacite et supplements' IN v_new) = 0
     OR position('v_extra_adult_fee numeric' IN v_new) = 0 OR position('INTO v_base_rate, v_base_occ' IN v_new) = 0 THEN
    RAISE EXCEPTION 'un motif est introuvable : create_reservation n''a pas ete modifiee';
  END IF;
  EXECUTE v_new;
END
$patch$;
