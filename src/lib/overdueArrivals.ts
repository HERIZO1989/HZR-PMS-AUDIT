// Arrivees en retard : clients dont le sejour est en cours mais jamais enregistres (statut « confirmee », arrivee passee, depart a venir).
// Le check-in automatique ne traite que les arrivees du jour : ces sejours restent invisibles (ni occupation ni revenu) tant qu'on ne les enregistre pas.

export interface OverdueReservation {
  id: string;
  confirmation_number: string;
  arrival_date: string;
  departure_date: string;
  total_amount: number;
  room_type_id: string | null;
  typeName: string | null;
  skip_auto_check_in: boolean;
}

export type OverdueKind = 'auto' | 'manual' | 'blocked';
export interface OverdueRow extends OverdueReservation { kind: OverdueKind; reason: string | null }

/**
 * Classe chaque sejour en cours non enregistre :
 * - auto : une chambre propre du type reserve existe (enregistrement possible en un clic) ;
 * - manual : type de chambre manquant ou plus de chambre propre du type (a faire avec le selecteur de chambre) ;
 * - blocked : check-in annule a la main (verrou) ou bloc en doublon de lignes par chambre : jamais enregistre automatiquement.
 * `cleanByType` : nombre de chambres propres par type ; `duplicateBases` : numeros de confirmation dont les lignes par chambre existent deja.
 * Les chambres propres sont consommees au fil de la liste (arrivees les plus anciennes d'abord) pour ne pas promettre deux fois la meme chambre.
 */
export function classifyOverdue(rows: OverdueReservation[], cleanByType: Record<string, number>, duplicateBases: Set<string>): OverdueRow[] {
  const left = { ...cleanByType };
  return [...rows]
    .sort((a, b) => a.arrival_date.localeCompare(b.arrival_date) || a.confirmation_number.localeCompare(b.confirmation_number))
    .map((r): OverdueRow => {
      if (r.skip_auto_check_in) return { ...r, kind: 'blocked', reason: 'Check-in annulé : à refaire manuellement' };
      if (duplicateBases.has(r.confirmation_number)) return { ...r, kind: 'blocked', reason: 'Doublon : les lignes par chambre de cette réservation existent déjà' };
      if (!r.room_type_id) return { ...r, kind: 'manual', reason: 'Type de chambre manquant : choisir une chambre' };
      if ((left[r.room_type_id] ?? 0) <= 0) return { ...r, kind: 'manual', reason: `Aucune chambre libre du type ${r.typeName ?? '?'}` };
      left[r.room_type_id] -= 1;
      return { ...r, kind: 'auto', reason: null };
    });
}

/** Numeros « blocs entiers » parmi `bases` qui ont au moins une ligne par chambre (base-1, base-2…) dans `allNumbers`. */
export function findDuplicateBases(bases: string[], allNumbers: string[]): Set<string> {
  const out = new Set<string>();
  for (const base of bases) {
    if (allNumbers.some((n) => n.startsWith(`${base}-`) && /^\d+$/.test(n.slice(base.length + 1)))) out.add(base);
  }
  return out;
}
