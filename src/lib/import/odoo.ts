import { createHash } from 'crypto';

/**
 * Specificites de l'export Odoo (module de reservation hoteliere, interface francaise) observees sur un export reel d'Anjary :
 * - liste groupee par statut : des lignes de regroupement du type "checkout (4219)" sans client ni date, avec un total agrege ;
 * - la colonne "Reference" (B00006...) est REUTILISEE : 720 references pour 4 667 sejours, avec des clients differents ;
 * - le client est un seul champ "NOM Prenom" (noms de famille en majuscules d'abord) ; aucune adresse e-mail ;
 * - statuts en francais (Sortie, Confirme, Attribue, Brouillon, Annule, Verrouiller).
 */

/** Ligne de regroupement : pas de client, pas de date, reference de la forme "texte (nombre)". */
export function isOdooGroupRow(ref: unknown, client: unknown, arrival: unknown, departure: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
  return empty(client) && empty(arrival) && empty(departure) && /\(\d+\)\s*$/.test(String(ref ?? '').trim());
}

/**
 * Numero de confirmation unique et reproductible : "<reference>-<AAMMJJ de l'arrivee>-<6 car. d'empreinte>".
 * L'empreinte porte sur reference + arrivee + depart (date et heure) + client : reimporter le meme fichier retrouve les memes numeros
 * (l'import ignore alors les reservations deja presentes) sans jamais fusionner deux sejours distincts.
 */
export function buildOdooConfirmationNumber(ref: string, arrival: unknown, departure: unknown, client: unknown): string {
  const base = ref.trim();
  const arr = String(arrival ?? '').trim();
  const digits = arr.replace(/\D/g, '').slice(2, 8); // 2026-04-28 12:00:00 -> 260428
  const hash = createHash('sha1')
    .update([base, arr, String(departure ?? '').trim(), String(client ?? '').trim().toLowerCase()].join('|'))
    .digest('hex')
    .slice(0, 6);
  return `${base}-${digits}-${hash}`;
}

const ORG_WORDS = new Set([
  'ASSOCIATION', 'SOCIETE', 'SOCIÉTÉ', 'SARL', 'SA', 'SAS', 'ONG', 'MINISTERE', 'MINISTÈRE', 'HOTEL', 'HÔTEL', 'GROUP', 'GROUPE',
  'COMPANY', 'ECOLE', 'ÉCOLE', 'FEDERATION', 'FÉDÉRATION', 'TROPHY', 'PARKS', 'DISTRIBUTION', 'FISHING', 'TRAVEL', 'TOURS',
  'AGENCE', 'BANQUE', 'BANK', 'UNIVERSITE', 'UNIVERSITÉ', 'COMMUNE', 'PROJET', 'PROJECT', 'SERVICES', 'LTD', 'INC', 'GMBH',
]);

const isCaps = (t: string) => /[A-ZÀ-Ý]/.test(t) && t === t.toUpperCase();
const titleCase = (t: string) => t.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

/**
 * Separe "NOM Prenom" d'Odoo. Convention de la base d'Anjary : nom de famille en majuscules en tete, prenoms ensuite.
 * - societe / association / nom d'un seul mot : tout va dans le nom de famille (prenom vide) ;
 * - tout en majuscules, 2 mots ou plus : le premier mot est le nom, le reste le prenom (remis en casse normale) ;
 * - casse mixte : la serie de mots en majuscules en tete est le nom, le reste le prenom ;
 * - casse mixte sans majuscules en tete (ex. "Ludovic Isidore") : dernier mot = nom (ordre « Prenom Nom »).
 */
export function splitOdooName(full: unknown): { first: string; last: string } {
  const name = String(full ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { first: '', last: '' };
  const tokens = name.split(' ');
  if (tokens.length === 1) return { first: '', last: name };
  if (/\d/.test(name) || tokens.some((t) => ORG_WORDS.has(t.toUpperCase()))) return { first: '', last: name };

  if (tokens.every(isCaps)) {
    return { last: tokens[0], first: tokens.slice(1).map(titleCase).join(' ') };
  }
  let i = 0;
  while (i < tokens.length && isCaps(tokens[i])) i++;
  if (i > 0 && i < tokens.length) return { last: tokens.slice(0, i).join(' '), first: tokens.slice(i).join(' ') };
  return { last: tokens[tokens.length - 1], first: tokens.slice(0, -1).join(' ') };
}

/** Compare sans tenir compte de la casse ni des accents ("Confirmé" == "confirme"). */
export function normalizeKey(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Statuts Odoo -> statuts du PMS.
 * "Verrouiller" (lock) : sur l'export d'Anjary, les 13 sejours concernes sont tous termines et 9 sur 13 sont « Entierement factures »
 * avec un paiement en cours : le verrouillage intervient apres la facturation, donc le sejour a bien eu lieu -> checked_out.
 * Pour revenir a une lecture prudente, remplacer par 'confirmed' ci-dessous (une seule ligne).
 */
export const ODOO_STATUS_MAP: Record<string, string> = {
  sortie: 'checked_out',
  annule: 'cancelled',
  confirme: 'confirmed',
  attribue: 'confirmed',
  brouillon: 'tentative',
  verrouiller: 'checked_out',
  verrouille: 'checked_out',
  // valeurs techniques des groupes Odoo (exports en anglais ou en-tetes de groupe)
  checkout: 'checked_out',
  cancel: 'cancelled',
  confirm: 'confirmed',
  allot: 'confirmed',
  initial: 'tentative',
  draft: 'tentative',
  lock: 'checked_out',
};
