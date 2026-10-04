-- TASK 21 : check-out ferme le folio soldé + regles d'audit "sejour depasse" et folios incoherents apres depart.

-- 1) check_out_reservation : apres le depart, le folio est recalcule puis ferme s'il est a 0.
--    Un solde > 0 (creance) ou < 0 (trop-percu) reste ouvert et sera signale par l'audit.
CREATE OR REPLACE FUNCTION public.check_out_reservation(p_reservation_id uuid, p_hotel_id uuid, p_staff_user_id uuid DEFAULT NULL::uuid)
 RETURNS reservations
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations;
  v_stay public.reservation_stays;
  v_folio_id uuid;
  v_balance numeric;
  v_folio_closed boolean := false;
BEGIN
  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id AND hotel_id = p_hotel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % introuvable pour cet hotel', p_reservation_id;
  END IF;
  IF v_res.status <> 'checked_in' THEN
    RAISE EXCEPTION 'Check-out impossible : statut actuel % (doit etre checked_in)', v_res.status;
  END IF;

  SELECT * INTO v_stay FROM public.reservation_stays
    WHERE reservation_id = p_reservation_id AND check_out_at IS NULL
    ORDER BY check_in_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun sejour ouvert trouve pour cette reservation';
  END IF;

  SELECT id INTO v_folio_id FROM public.folios WHERE reservation_id = p_reservation_id LIMIT 1;
  IF v_folio_id IS NULL THEN
    RAISE EXCEPTION 'Aucun folio associe a cette reservation : check-out impossible';
  END IF;

  UPDATE public.reservation_stays SET check_out_at = now(), updated_at = now() WHERE id = v_stay.id;

  UPDATE public.rooms SET status='vacant_dirty', updated_at=now() WHERE id = v_stay.room_id;

  UPDATE public.reservations SET status='checked_out', updated_at=now() WHERE id = p_reservation_id RETURNING * INTO v_res;

  INSERT INTO public.housekeeping_tasks(tenant_id, hotel_id, room_id, task_type, status, priority, scheduled_for)
  VALUES (v_res.tenant_id, p_hotel_id, v_stay.room_id, 'turnover', 'pending', 'normal', now());

  v_balance := public.recompute_folio_balance(v_folio_id);
  IF v_balance = 0 THEN
    UPDATE public.folios SET status = 'closed', closed_at = now(), updated_at = now()
      WHERE id = v_folio_id AND status = 'open';
    v_folio_closed := true;
  END IF;

  PERFORM public.log_audit_event(v_res.tenant_id, p_hotel_id, p_staff_user_id, 'reservation','check_out','reservation', p_reservation_id,
    jsonb_build_object('room_id', v_stay.room_id, 'folio_id', v_folio_id,
      'folio_balance_at_checkout', v_balance, 'folio_closed', v_folio_closed));

  RETURN v_res;
END;
$function$;

-- 2) run_hotel_audit : deux regles ajoutees avant le RETURN (le reste est inchange).
CREATE OR REPLACE FUNCTION public.run_hotel_audit(p_hotel_id uuid, p_start_date date DEFAULT (CURRENT_DATE - 30), p_end_date date DEFAULT (CURRENT_DATE - 1))
 RETURNS TABLE(critical_count integer, warning_count integer, info_count integer, total_findings integer, avg_occupancy numeric, avg_adr numeric, avg_revpar numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_today date;
BEGIN
  SELECT h.tenant_id, (now() AT TIME ZONE COALESCE(h.timezone, 'UTC'))::date INTO v_tenant_id, v_today
  FROM public.hotels h WHERE h.id = p_hotel_id;

  PERFORM public.compute_kpi_snapshots(p_hotel_id, p_start_date, p_end_date);

  -- Clear previous auto-generated open findings so the audit reflects the current state
  DELETE FROM public.audit_findings af WHERE af.hotel_id = p_hotel_id AND af.status = 'open';

  -- Statistical anomalies: occupancy impossible
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, k.business_date, 'occupancy','critical',
    'Taux d''occupation incohérent',
    'Le taux d''occupation calculé pour le '||k.business_date||' est de '||round(k.occupancy_rate*100,1)||'%, ce qui dépasse la capacité réelle de l''hôtel.',
    'Vérifier les doublons de réservations ou les chambres comptées deux fois ce jour-là.',
    'open'
  FROM public.kpi_daily_snapshots k
  WHERE k.hotel_id = p_hotel_id AND k.business_date BETWEEN p_start_date AND p_end_date
    AND k.occupancy_rate > 1;

  -- Statistical anomalies: ADR outliers (>1.5 stddev from period average)
  WITH stats AS (
    SELECT avg(adr) a, stddev_samp(adr) s
    FROM public.kpi_daily_snapshots
    WHERE hotel_id = p_hotel_id AND business_date BETWEEN p_start_date AND p_end_date AND rooms_occupied > 0
  )
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, k.business_date, 'adr','warning',
    'Anomalie tarifaire (ADR)',
    'ADR du '||k.business_date||' = '||k.adr||' '||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||' contre une moyenne de '||round(stats.a,2)||' '||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||' sur la période (écart-type '||round(stats.s,2)||').',
    'Contrôler les tarifs saisis, remises exceptionnelles ou erreurs de plan tarifaire pour cette date.',
    'open'
  FROM public.kpi_daily_snapshots k, stats
  WHERE k.hotel_id = p_hotel_id AND k.business_date BETWEEN p_start_date AND p_end_date
    AND stats.s > 0 AND abs(k.adr - stats.a) > 1.5 * stats.s;

  -- Statistical anomalies: RevPAR outliers
  WITH stats AS (
    SELECT avg(revpar) a, stddev_samp(revpar) s
    FROM public.kpi_daily_snapshots
    WHERE hotel_id = p_hotel_id AND business_date BETWEEN p_start_date AND p_end_date
  )
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, k.business_date, 'revpar','warning',
    'Anomalie de revenu par chambre (RevPAR)',
    'RevPAR du '||k.business_date||' = '||k.revpar||' '||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||' contre une moyenne de '||round(stats.a,2)||' '||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||' sur la période.',
    'Analyser la combinaison occupation/tarif de cette journée pour identifier la cause.',
    'open'
  FROM public.kpi_daily_snapshots k, stats
  WHERE k.hotel_id = p_hotel_id AND k.business_date BETWEEN p_start_date AND p_end_date
    AND stats.s > 0 AND abs(k.revpar - stats.a) > 1.5 * stats.s;

  -- Financial: unpaid checkouts
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, r.departure_date, 'financial','critical',
    'Facture non soldée après départ',
    'La réservation '||r.confirmation_number||' est check-out mais le folio '||f.folio_number||' reste ouvert avec un solde de '||f.balance||' '||f.currency_code||'.',
    'Contacter le client pour encaissement du solde ou passer en perte selon la politique de l''hôtel.',
    'open'
  FROM public.reservations r
  JOIN public.folios f ON f.reservation_id = r.id
  WHERE r.hotel_id = p_hotel_id AND r.status = 'checked_out' AND f.status = 'open' AND f.balance > 0;

  -- TASK 21 - Financial: folio ouvert a solde nul apres depart, ou trop-percu
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, r.departure_date, 'financial','warning',
    CASE WHEN f.balance < 0 THEN 'Trop-perçu sur folio après départ' ELSE 'Folio resté ouvert après départ' END,
    'La réservation '||r.confirmation_number||' est check-out mais le folio '||f.folio_number||' est '||
      CASE WHEN f.balance < 0 THEN 'ouvert avec un trop-perçu de '||abs(f.balance) ELSE 'ouvert avec un solde nul' END||' '||f.currency_code||'.',
    CASE WHEN f.balance < 0 THEN 'Vérifier les nuitées postées puis rembourser ou régulariser le trop-perçu avant de fermer le folio.'
         ELSE 'Vérifier que toutes les nuitées ont bien été postées, puis fermer le folio.' END,
    'open'
  FROM public.reservations r
  JOIN public.folios f ON f.reservation_id = r.id
  WHERE r.hotel_id = p_hotel_id AND r.status = 'checked_out' AND f.status = 'open' AND f.balance <= 0;

  -- TASK 21 - Data integrity: sejour toujours en cours alors que la date de depart est depassee
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, r.departure_date, 'data_integrity','warning',
    'Séjour dépassé non clôturé',
    'La réservation '||r.confirmation_number||' est toujours en check-in alors que le départ était prévu le '||r.departure_date||' ('||(v_today - r.departure_date)||' jour(s) de retard).',
    'Effectuer le check-out, ou prolonger le séjour si le client est encore en chambre.',
    'open'
  FROM public.reservations r
  WHERE r.hotel_id = p_hotel_id AND r.status = 'checked_in' AND r.departure_date < v_today;

  -- Compliance: blacklisted guest with active reservation
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, current_date, 'compliance','critical',
    'Client interdit avec réservation active',
    'Le client '||g.first_name||' '||g.last_name||' est marqué en liste noire mais possède une réservation active ('||r.confirmation_number||').',
    'Vérifier l''identité du client et escalader vers la direction avant l''arrivée.',
    'open'
  FROM public.reservations r
  JOIN public.guests g ON g.id = r.guest_id
  WHERE r.hotel_id = p_hotel_id AND g.is_blacklisted = true AND r.status IN ('confirmed','checked_in');

  -- Data integrity: room status mismatch on checked-in reservations
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, current_date, 'data_integrity','warning',
    'Incohérence statut chambre',
    'La réservation '||r.confirmation_number||' est en check-in mais la chambre '||rm.room_number||' est au statut "'||rm.status||'" au lieu de "occupied".',
    'Synchroniser le statut physique de la chambre avec le système de réservation.',
    'open'
  FROM public.reservations r
  JOIN public.rooms rm ON rm.id = r.assigned_room_id
  WHERE r.hotel_id = p_hotel_id AND r.status = 'checked_in' AND rm.status <> 'occupied';

  -- Compliance: unresolved night audit warnings/failures
  INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
  SELECT v_tenant_id, p_hotel_id, nar.business_date, 'compliance','warning',
    'Alerte night audit non résolue',
    'Le contrôle "'||nac.check_type||'" du night audit du '||nar.business_date||' est en statut "'||nac.status||'".',
    'Examiner le détail du contrôle et statuer avant la clôture comptable définitive.',
    'open'
  FROM public.night_audit_checks nac
  JOIN public.night_audit_runs nar ON nar.id = nac.night_audit_run_id
  WHERE nar.hotel_id = p_hotel_id AND nac.status IN ('warning','failed');

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE af.severity='critical')::int,
    count(*) FILTER (WHERE af.severity='warning')::int,
    count(*) FILTER (WHERE af.severity='info')::int,
    count(*)::int,
    (SELECT round(avg(k.occupancy_rate),4) FROM public.kpi_daily_snapshots k WHERE k.hotel_id=p_hotel_id AND k.business_date BETWEEN p_start_date AND p_end_date),
    (SELECT round(avg(k.adr),2) FROM public.kpi_daily_snapshots k WHERE k.hotel_id=p_hotel_id AND k.business_date BETWEEN p_start_date AND p_end_date),
    (SELECT round(avg(k.revpar),2) FROM public.kpi_daily_snapshots k WHERE k.hotel_id=p_hotel_id AND k.business_date BETWEEN p_start_date AND p_end_date)
  FROM public.audit_findings af
  WHERE af.hotel_id = p_hotel_id AND af.status = 'open';
END;
$function$;
