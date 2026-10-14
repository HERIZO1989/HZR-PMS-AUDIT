-- TASK 40 : regles statistiques ADR / RevPAR de l'audit : baisses seulement, seuil 2,5 ecarts-types.
-- Avant (1,5 ecart-type, dans les deux sens) : 6 avertissements a Anjary sur des jours simplement differents de la moyenne
-- (ADR plus eleve, RevPAR plus haut), soit du bruit. Un ADR ou un RevPAR anormalement BAS signale une remise ou une erreur de facturation ;
-- un jour plus haut que la moyenne n'appelle pas d'action. Minimum de 7 jours occupes sur la periode (TASK 25) conserve.
-- Limite connue : moyenne et ecart-type ne sont pas robustes ; un jour extremement haut peut masquer une baisse sur la meme periode.
DO $patch$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('public.run_hotel_audit'::regproc);
  IF position('ADR anormalement bas' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position('abs(k.adr - stats.a) > 1.5 * stats.s;' IN d) = 0 OR position('abs(k.revpar - stats.a) > 1.5 * stats.s;' IN d) = 0
     OR position('''Anomalie tarifaire (ADR)''' IN d) = 0 OR position('''Anomalie de revenu par chambre (RevPAR)''' IN d) = 0 THEN
    RAISE EXCEPTION 'run_hotel_audit : marqueurs ADR/RevPAR introuvables, patch annule';
  END IF;
  d := replace(d, 'abs(k.adr - stats.a) > 1.5 * stats.s;', '(stats.a - k.adr) > 2.5 * stats.s;');
  d := replace(d, 'abs(k.revpar - stats.a) > 1.5 * stats.s;', '(stats.a - k.revpar) > 2.5 * stats.s;');
  d := replace(d, '''Anomalie tarifaire (ADR)''', '''ADR anormalement bas''');
  d := replace(d, '''Anomalie de revenu par chambre (RevPAR)''', '''RevPAR anormalement bas''');
  EXECUTE d;
END
$patch$;
