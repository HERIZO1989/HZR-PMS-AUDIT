-- TASK 20 - Posting automatique des nuitees chaque nuit (pg_cron).
--
-- hotels.auto_post_room_charges (defaut false : opt-in, la demo Riviera n'est pas modifiee). Anjary : actif.
-- post_room_charges_nightly(p_force) : pour chaque hotel opt-in, a 03h locale (fuseau de l'hotel), poste les
-- nuitees de la nuit qui vient de se terminer (veille locale). p_force = true ignore le controle de l'heure
-- (tests / rattrapage manuel). Un hotel en erreur n'empeche pas les autres. Idempotent : relancer ne duplique rien.
-- Planification : toutes les heures a la minute 7 (UTC) ; seul le passage ou il est 03h locale agit,
-- ce qui gere plusieurs fuseaux horaires sans job par hotel.

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS auto_post_room_charges boolean NOT NULL DEFAULT false;

UPDATE public.hotels SET auto_post_room_charges = true
WHERE id = '232568ba-61b6-4f5b-9c8c-1ae7bc8a834c';

CREATE OR REPLACE FUNCTION public.post_room_charges_nightly(p_force boolean DEFAULT false)
RETURNS TABLE(hotel_id uuid, business_date date, posted integer, skipped integer, total_posted numeric)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  h record;
  v_local timestamp;
  v_date date;
  r record;
BEGIN
  FOR h IN SELECT x.id, COALESCE(x.timezone, 'UTC') AS tz FROM public.hotels x WHERE x.auto_post_room_charges LOOP
    BEGIN
      v_local := now() AT TIME ZONE h.tz;
      CONTINUE WHEN NOT p_force AND extract(hour FROM v_local) <> 3;
      v_date := v_local::date - 1;
      SELECT * INTO r FROM public.post_room_charges(h.id, v_date, NULL);
      hotel_id := h.id; business_date := v_date; posted := r.posted; skipped := r.skipped; total_posted := r.total_posted;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'post_room_charges_nightly : echec pour l''hotel % : %', h.id, SQLERRM;
    END;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_room_charges_nightly(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_room_charges_nightly(boolean) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $sched$
BEGIN
  PERFORM cron.unschedule('post-room-charges-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-room-charges-nightly');
  PERFORM cron.schedule('post-room-charges-nightly', '7 * * * *', 'SELECT * FROM public.post_room_charges_nightly();');
END
$sched$;
