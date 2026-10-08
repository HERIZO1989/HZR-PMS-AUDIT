-- TASK 33 (PREPAREE, NON APPLIQUEE) : sejours a la journee (day use).
-- L'export Odoo d'Anjary compte 275 sejours dont l'arrivee et le depart tombent le meme jour (40,7 M Ar), que la contrainte
-- `departure_date > arrival_date` refuse. On ajoute un type de sejour : seul 'day_use' peut avoir arrivee = depart.
--
-- Pourquoi c'est sans effet sur le reste du PMS (verifie dans la base) :
--  * stay_range = daterange(arrivee, depart, '[)') est vide quand arrivee = depart : la contrainte anti-chevauchement des chambres
--    (reservations_no_room_overlap) ne peut donc jamais se declencher ;
--  * occupation, KPI et nuitees se calculent sur des nuits (depart > jour) : un sejour a la journee n'est jamais compte comme une nuit ;
--  * aucun declencheur sur reservations.
-- Compatibilite : la colonne a une valeur par defaut ('overnight'), les ecritures existantes ne changent pas.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS stay_type text NOT NULL DEFAULT 'overnight';

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reservations'::regclass AND conname = 'reservations_stay_type_check') THEN
    ALTER TABLE public.reservations ADD CONSTRAINT reservations_stay_type_check CHECK (stay_type IN ('overnight', 'day_use'));
  END IF;
END
$c$;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_check
  CHECK (departure_date > arrival_date OR (stay_type = 'day_use' AND departure_date = arrival_date));

-- L'import transmet le type de sejour.
DO $patch$
DECLARE
  d text;
  cols_old text := E'arrival_date, departure_date, adults, children, total_amount, currency_code\n      ) VALUES (';
  cols_new text := E'arrival_date, departure_date, adults, children, total_amount, currency_code, stay_type\n      ) VALUES (';
  vals_old text := E'''EUR'')\n      )\n      RETURNING id INTO v_res_id;';
  vals_new text := E'''EUR''),\n        COALESCE(v_data->>''stay_type'', ''overnight'')\n      )\n      RETURNING id INTO v_res_id;';
BEGIN
  d := pg_get_functiondef('public.apply_import_row'::regproc);
  IF position('stay_type' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position(cols_old IN d) = 0 OR position(vals_old IN d) = 0 THEN
    RAISE EXCEPTION 'apply_import_row : marqueurs d''insertion introuvables, patch annule';
  END IF;
  EXECUTE replace(replace(d, cols_old, cols_new), vals_old, vals_new);
END
$patch$;
