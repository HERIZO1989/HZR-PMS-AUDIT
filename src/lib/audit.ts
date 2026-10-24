// Controles d'audit des donnees : anomalies detectees en permanence, avec leur montant et des exemples.
import type { DepositSummary } from './deposits';

export type Severity = 'high' | 'medium' | 'low' | 'ok';

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  count: number;
  /** Montant concerne (TTC pour les factures et reservations, HT pour les depenses), si pertinent. */
  amount: number | null;
  detail: string;
  action: string;
  columns: string[];
  examples: string[][];
}

export interface AuditInvoice {
  invoice_number: string | null; partner_name: string; invoice_date: string; due_date: string | null;
  amount_ttc: number; payment_status: string; payment_date: string | null;
}
export interface AuditReservation { confirmation_number: string; arrival_date: string; departure_date: string; total_amount: number }
export interface AuditExpenseStats {
  approvedHt: number;
  otherHt: number;
  topOtherSuppliers: { label: string; count: number; amountHt: number }[];
  pendingCount: number;
  pendingHt: number;
  personnelApprovedHt: number;
}
export interface AuditInput {
  today: string;
  invoices: AuditInvoice[];
  confirmedPast: AuditReservation[];
  noRoomType: { count: number; examples: AuditReservation[] };
  expenses: AuditExpenseStats;
  deposits: DepositSummary;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, ok: 3 };

export function buildFindings(input: AuditInput): Finding[] {
  const out: Finding[] = [];

  // 1. Numeros de facture utilises par plusieurs factures.
  const byNumber = new Map<string, AuditInvoice[]>();
  for (const i of input.invoices) {
    if (!i.invoice_number) continue;
    const list = byNumber.get(i.invoice_number) ?? [];
    list.push(i);
    byNumber.set(i.invoice_number, list);
  }
  const dups = [...byNumber.entries()].filter(([, l]) => l.length > 1);
  const dupInvoices = dups.reduce((t, [, l]) => t + l.length, 0);
  const dupAmount = round2(dups.reduce((t, [, l]) => t + l.reduce((s, i) => s + Number(i.amount_ttc), 0), 0));
  out.push({
    id: 'duplicate-invoice-numbers', title: 'Numéros de facture en double',
    severity: dups.length > 0 ? 'high' : 'ok', count: dups.length, amount: dups.length > 0 ? dupAmount : null,
    detail: dups.length > 0
      ? `${dups.length} numéros sont portés chacun par plusieurs factures différentes (${dupInvoices} factures). Un numéro de facture doit être unique : risque comptable et fiscal.`
      : 'Chaque numéro de facture est unique.',
    action: 'Faire corriger la séquence de numérotation dans Odoo (deux séquences semblent écrire dans la même série FAC).',
    columns: ['N° de facture', 'Factures', 'Clients', 'Montant TTC'],
    examples: dups
      .map(([n, l]) => ({ n, l, total: l.reduce((s, i) => s + Number(i.amount_ttc), 0) }))
      .sort((a, b) => b.total - a.total).slice(0, 10)
      .map(({ n, l, total }) => [n, String(l.length), [...new Set(l.map((i) => i.partner_name))].slice(0, 2).join(' / '), fmt(total)]),
  });

  // 2. Creances de plus de 90 jours.
  const open = input.invoices.filter((i) => i.payment_status === 'unpaid' || i.payment_status === 'partial');
  const openTotal = open.reduce((t, i) => t + Number(i.amount_ttc), 0);
  const old = open.filter((i) => daysBetween(i.invoice_date, input.today) > 90);
  const oldTotal = round2(old.reduce((t, i) => t + Number(i.amount_ttc), 0));
  const byClient = new Map<string, { n: number; total: number; oldest: string }>();
  for (const i of old) {
    const c = byClient.get(i.partner_name) ?? { n: 0, total: 0, oldest: i.invoice_date };
    c.n += 1; c.total += Number(i.amount_ttc); if (i.invoice_date < c.oldest) c.oldest = i.invoice_date;
    byClient.set(i.partner_name, c);
  }
  const share = openTotal > 0 ? oldTotal / openTotal : 0;
  out.push({
    id: 'aged-receivables', title: 'Créances de plus de 90 jours',
    severity: old.length === 0 ? 'ok' : share >= 0.25 ? 'high' : 'medium', count: old.length, amount: old.length > 0 ? oldTotal : null,
    detail: old.length > 0
      ? `${old.length} factures non soldées ont plus de 90 jours (${Math.round(share * 100)} % des créances). Plus une créance vieillit, moins elle a de chances d'être recouvrée.`
      : 'Aucune créance de plus de 90 jours.',
    action: 'Relancer les principaux débiteurs, proposer un échéancier, provisionner ce qui est douteux.',
    columns: ['Client', 'Factures', 'Plus ancienne', 'Montant TTC'],
    examples: [...byClient.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([c, v]) => [c, String(v.n), v.oldest, fmt(v.total)]),
  });

  // 3. Sejours termines restes « Confirme ».
  const past = input.confirmedPast;
  const pastNights = past.reduce((t, r) => t + Math.max(0, daysBetween(r.arrival_date, r.departure_date)), 0);
  const pastAmount = round2(past.reduce((t, r) => t + Number(r.total_amount), 0));
  out.push({
    id: 'confirmed-past-stays', title: 'Séjours terminés encore « Confirmé »',
    severity: past.length > 0 ? 'medium' : 'ok', count: past.length, amount: past.length > 0 ? pastAmount : null,
    detail: past.length > 0
      ? `${past.length} réservations dont le séjour est terminé n'ont jamais été clôturées (${pastNights} nuits). Elles ne comptent ni dans l'occupation ni dans le revenu hébergement.`
      : 'Aucun séjour terminé en attente de clôture.',
    action: 'Les clôturer si le séjour a eu lieu (facturé), ou les passer en no-show.',
    columns: ['Réservation', 'Arrivée', 'Départ', 'Montant'],
    examples: [...past].sort((a, b) => Number(b.total_amount) - Number(a.total_amount)).slice(0, 10)
      .map((r) => [r.confirmation_number, r.arrival_date, r.departure_date, fmt(Number(r.total_amount))]),
  });

  // 4. Reservations sans type de chambre.
  out.push({
    id: 'no-room-type', title: 'Réservations sans type de chambre',
    severity: input.noRoomType.count > 0 ? 'low' : 'ok', count: input.noRoomType.count, amount: null,
    detail: input.noRoomType.count > 0
      ? `${input.noRoomType.count} réservations n'ont pas de type de chambre (tarif hors grille ou ambigu à l'import). Elles comptent dans l'occupation, pas dans l'analyse par catégorie.`
      : 'Toutes les réservations ont un type de chambre.',
    action: 'Compléter le type de chambre quand le tarif ne suffit pas à le déduire.',
    columns: ['Réservation', 'Arrivée', 'Départ', 'Montant'],
    examples: input.noRoomType.examples.slice(0, 10).map((r) => [r.confirmation_number, r.arrival_date, r.departure_date, fmt(Number(r.total_amount))]),
  });

  // 5. Depenses non classees.
  const e = input.expenses;
  const otherShare = e.approvedHt > 0 ? e.otherHt / e.approvedHt : 0;
  out.push({
    id: 'unclassified-expenses', title: 'Dépenses non classées',
    severity: otherShare > 0.2 ? 'medium' : otherShare > 0.05 ? 'low' : 'ok', count: e.topOtherSuppliers.length, amount: e.otherHt > 0 ? round2(e.otherHt) : null,
    detail: e.otherHt > 0 ? `${Math.round(otherShare * 100)} % des dépenses approuvées (HT) sont en « Autres dépenses » : les ratios de charges et le GOP par poste ne sont pas fiables.` : 'Toutes les dépenses sont classées.',
    action: 'Classer les fournisseurs depuis l\'écran Dépenses (panneau « Classer les fournisseurs »).',
    columns: ['Fournisseur', 'Dépenses', 'Montant HT'],
    examples: e.topOtherSuppliers.slice(0, 10).map((s) => [s.label, String(s.count), fmt(s.amountHt)]),
  });

  // 6. Charges de personnel absentes.
  out.push({
    id: 'missing-payroll', title: 'Charges de personnel',
    severity: e.personnelApprovedHt > 0 ? 'ok' : 'high', count: e.personnelApprovedHt > 0 ? 0 : 1, amount: null,
    detail: e.personnelApprovedHt > 0 ? 'Des charges de personnel sont approuvées : le GOP en tient compte.' : 'Aucune charge de personnel approuvée : le GOP et sa marge sont surévalués.',
    action: 'Saisir ou importer les salaires et charges sociales (catégorie « Personnel »).',
    columns: [], examples: [],
  });

  // 7. Depenses en attente d'approbation.
  out.push({
    id: 'pending-expenses', title: 'Dépenses en attente d\'approbation',
    severity: e.pendingCount > 0 ? 'low' : 'ok', count: e.pendingCount, amount: e.pendingCount > 0 ? round2(e.pendingHt) : null,
    detail: e.pendingCount > 0 ? `${e.pendingCount} dépenses attendent une approbation et ne comptent pas encore dans le GOP.` : 'Aucune dépense en attente.',
    action: 'Les vérifier puis les approuver ou les rejeter (montants douteux de l\'import : devise ?).',
    columns: [], examples: [],
  });

  // 8. Acomptes.
  const d = input.deposits;
  out.push({
    id: 'deposits-to-apply', title: 'Acomptes non reportés sur le folio',
    severity: d.toApply.count > 0 ? 'high' : 'ok', count: d.toApply.count, amount: d.toApply.count > 0 ? d.toApply.amount : null,
    detail: d.toApply.count > 0 ? `${d.toApply.count} acomptes de clients déjà arrivés n'ont pas été déduits de leur solde : risque de double encaissement.` : 'Tous les acomptes des clients arrivés sont reportés.',
    action: 'Vérifier le folio avec la réception et reporter l\'acompte.', columns: [], examples: [],
  });
  out.push({
    id: 'deposits-to-resolve', title: 'Acomptes d\'annulations à traiter',
    severity: d.toResolve.count > 0 ? 'medium' : 'ok', count: d.toResolve.count, amount: d.toResolve.count > 0 ? d.toResolve.amount : null,
    detail: d.toResolve.count > 0 ? `${d.toResolve.count} acomptes de réservations annulées ou no-show n'ont été ni remboursés ni conservés.` : 'Aucun acompte d\'annulation en suspens.',
    action: 'Rembourser ou conserver (pénalité) depuis le bouton Acompte de la réservation.', columns: [], examples: [],
  });

  // 9. Factures payees sans date de paiement.
  const noPayDate = input.invoices.filter((i) => (i.payment_status === 'paid' || i.payment_status === 'in_payment') && !i.payment_date);
  out.push({
    id: 'paid-without-date', title: 'Factures payées sans date de paiement',
    severity: noPayDate.length > 0 ? 'low' : 'ok', count: noPayDate.length, amount: noPayDate.length > 0 ? round2(noPayDate.reduce((t, i) => t + Number(i.amount_ttc), 0)) : null,
    detail: noPayDate.length > 0 ? `${noPayDate.length} factures sont payées mais sans date : elles ne figurent dans aucun encaissement daté.` : 'Toutes les factures payées ont une date de paiement.',
    action: 'Renseigner la date de paiement dans Odoo.',
    columns: ['N° de facture', 'Client', 'Montant TTC'],
    examples: noPayDate.slice(0, 10).map((i) => [i.invoice_number ?? '—', i.partner_name, fmt(Number(i.amount_ttc))]),
  });

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
