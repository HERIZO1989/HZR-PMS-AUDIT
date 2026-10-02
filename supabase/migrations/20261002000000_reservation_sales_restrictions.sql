-- TASK 15 - Restrictions de vente du calendrier tarifaire dans create_reservation.
--
-- rate_calendar porte deja stop_sell, closed_to_arrival, closed_to_departure, min_stay et max_stay,
-- mais create_reservation ne les consultait pas. Regles appliquees pour le plan retenu :
--  * stop_sell : refus si une des nuits du sejour est fermee a la vente ;
--  * closed_to_arrival : refus si la date d'arrivee est fermee a l'arrivee ;
--  * closed_to_departure : refus si la date de depart est fermee au depart ;
--  * min_stay / max_stay : evalues sur la date d'arrivee, par rapport au nombre de nuits.
-- Aucune ligne de calendrier pour la date concernee = aucune restriction. Non gere : allotment.
-- Patch par remplacement de texte sur la definition courante (signature inchangee, pas de surcharge).

DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_block text;
BEGIN
  v_def := pg_get_functiondef('public.create_reservation(uuid,uuid,uuid,date,date,uuid,text,text,text,uuid,integer,integer,text,uuid,text,uuid)'::regprocedure);
  IF position('Restrictions de vente' IN v_def) > 0 THEN
    RAISE EXCEPTION 'create_reservation contient deja les restrictions de vente';
  END IF;

  v_new := replace(v_def,
    E'  v_res public.reservations;\nBEGIN',
    E'  v_res public.reservations;\n  v_blocked date;\n  v_min_stay int;\n  v_max_stay int;\n  v_closed boolean;\nBEGIN');

  v_block := $blk$
  v_nights := p_departure_date - p_arrival_date;

  -- Restrictions de vente du calendrier pour le plan retenu
  IF v_plan_id IS NOT NULL THEN
    SELECT rc.date INTO v_blocked FROM public.rate_calendar rc
    WHERE rc.rate_plan_id = v_plan_id AND rc.room_type_id = p_room_type_id AND rc.hotel_id = p_hotel_id
      AND rc.date >= p_arrival_date AND rc.date < p_departure_date AND rc.stop_sell
    ORDER BY rc.date LIMIT 1;
    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION 'Plan tarifaire ferme a la vente le % (stop-sell)', v_blocked;
    END IF;

    SELECT rc.closed_to_arrival, rc.min_stay, rc.max_stay INTO v_closed, v_min_stay, v_max_stay
    FROM public.rate_calendar rc
    WHERE rc.rate_plan_id = v_plan_id AND rc.room_type_id = p_room_type_id AND rc.hotel_id = p_hotel_id
      AND rc.date = p_arrival_date;
    IF COALESCE(v_closed, false) THEN
      RAISE EXCEPTION 'Arrivee impossible le % (ferme a l''arrivee)', p_arrival_date;
    END IF;
    IF COALESCE(v_min_stay, 1) > v_nights THEN
      RAISE EXCEPTION 'Sejour minimum de % nuits pour une arrivee le %', v_min_stay, p_arrival_date;
    END IF;
    IF v_max_stay IS NOT NULL AND v_nights > v_max_stay THEN
      RAISE EXCEPTION 'Sejour maximum de % nuits pour une arrivee le %', v_max_stay, p_arrival_date;
    END IF;

    SELECT rc.closed_to_departure INTO v_closed FROM public.rate_calendar rc
    WHERE rc.rate_plan_id = v_plan_id AND rc.room_type_id = p_room_type_id AND rc.hotel_id = p_hotel_id
      AND rc.date = p_departure_date;
    IF COALESCE(v_closed, false) THEN
      RAISE EXCEPTION 'Depart impossible le % (ferme au depart)', p_departure_date;
    END IF;
  END IF;
$blk$;

  v_new := replace(v_new, E'\n  v_nights := p_departure_date - p_arrival_date;\n', v_block);
  IF v_new = v_def OR position('Restrictions de vente' IN v_new) = 0 THEN
    RAISE EXCEPTION 'motif v_nights introuvable : create_reservation n''a pas ete modifiee';
  END IF;
  EXECUTE v_new;
END
$patch$;
