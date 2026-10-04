import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NightAuditReportData {
  hotelName: string;
  currency: string;
  businessDate: string;
  generatedAt: string;
  kpi: { roomsAvailable: number; roomsOccupied: number; occupancyRate: number; adr: number; revpar: number; roomRevenue: number } | null;
  posting: { nights: number; netTotal: number; vatTotal: number; grossTotal: number };
  inHouse: { confirmation: string; guest: string; room: string; departure: string }[];
  debtors: { confirmation: string; guest: string; balance: number }[];
  findings: { severity: string; title: string; description: string }[];
}

/** Formatage maison : evite l'espace insecable fine de Intl, absente du jeu WinAnsi de Helvetica. */
export function fmtMoney(n: number, currency: string): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, dec] = Math.abs(rounded).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '-' : ''}${grouped}${dec === '00' ? '' : ',' + dec} ${currency}`;
}

/** Remplace les caracteres hors WinAnsi (Helvetica standard) pour ne jamais faire echouer le rendu. */
function safe(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u202F\u00A0]/g, ' ')
    .replace(/[^\x20-\x7E\u00A1-\u00FF\u0152\u0153\u20AC\u2013\u2014\u2022]/g, '?');
}

export async function buildNightAuditReportData(
  supabase: SupabaseClient,
  hotelId: string,
  businessDate: string
): Promise<NightAuditReportData> {
  const { data: hotel, error: hErr } = await supabase
    .from('hotels')
    .select('name, currency_code')
    .eq('id', hotelId)
    .single();
  if (hErr || !hotel) throw new Error('Hôtel introuvable');

  const { data: kpi } = await supabase
    .from('kpi_daily_snapshots')
    .select('rooms_available, rooms_occupied, occupancy_rate, adr, revpar, total_room_revenue')
    .eq('hotel_id', hotelId)
    .eq('business_date', businessDate)
    .maybeSingle();

  const { data: lines } = await supabase
    .from('folio_lines')
    .select('line_type, amount')
    .eq('hotel_id', hotelId)
    .eq('reference', `NIGHT:${businessDate}`)
    .in('line_type', ['room_charge', 'tax']);
  let net = 0, vat = 0, nights = 0;
  for (const l of lines ?? []) {
    if (l.line_type === 'room_charge') { net += Number(l.amount); nights += 1; }
    else vat += Number(l.amount);
  }

  const { data: stays } = await supabase
    .from('reservations')
    .select('confirmation_number, departure_date, guests ( first_name, last_name ), rooms ( room_number )')
    .eq('hotel_id', hotelId)
    .eq('status', 'checked_in')
    .lte('arrival_date', businessDate)
    .gt('departure_date', businessDate)
    .order('departure_date');

  const { data: debts } = await supabase
    .from('folios')
    .select('balance, reservations ( confirmation_number ), guests ( first_name, last_name )')
    .eq('hotel_id', hotelId)
    .eq('status', 'open')
    .gt('balance', 0)
    .order('balance', { ascending: false });

  const { data: findings } = await supabase
    .from('audit_findings')
    .select('severity, title, description')
    .eq('hotel_id', hotelId)
    .eq('status', 'open');
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const name = (g: { first_name: string; last_name: string } | null) => (g ? `${g.first_name} ${g.last_name}` : '—');

  return {
    hotelName: hotel.name,
    currency: hotel.currency_code,
    businessDate,
    generatedAt: new Date().toISOString(),
    kpi: kpi
      ? {
          roomsAvailable: kpi.rooms_available,
          roomsOccupied: kpi.rooms_occupied,
          occupancyRate: Number(kpi.occupancy_rate),
          adr: Number(kpi.adr),
          revpar: Number(kpi.revpar),
          roomRevenue: Number(kpi.total_room_revenue),
        }
      : null,
    posting: { nights, netTotal: net, vatTotal: vat, grossTotal: net + vat },
    inHouse: (stays ?? []).map((r: any) => ({
      confirmation: r.confirmation_number,
      guest: name(one(r.guests)),
      room: one<{ room_number: string }>(r.rooms)?.room_number ?? '—',
      departure: r.departure_date,
    })),
    debtors: (debts ?? []).map((f: any) => ({
      confirmation: one<{ confirmation_number: string }>(f.reservations)?.confirmation_number ?? '—',
      guest: name(one(f.guests)),
      balance: Number(f.balance),
    })),
    findings: [...(findings ?? [])].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)),
  };
}

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const BRASS = rgb(0.62, 0.48, 0.22);
const RED = rgb(0.72, 0.15, 0.15);
const AMBER = rgb(0.75, 0.5, 0.05);

export async function renderNightAuditPdf(d: NightAuditReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x, y, size, font: f, color });
  const wrap = (s: string, size: number, maxW: number, f: PDFFont = font): string[] => {
    const out: string[] = [];
    let line = '';
    for (const word of safe(s).split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const section = (title: string) => {
    need(40);
    y -= 14;
    text(title, M, 12, bold, BRASS);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: BRASS });
    y -= 16;
  };

  text(d.hotelName, M, 20, bold);
  y -= 20;
  text(`Rapport Night Audit  -  date d'exploitation ${d.businessDate}`, M, 11, font, MUTED);
  y -= 14;
  text(`Généré le ${d.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, M, 8, font, MUTED);
  y -= 8;

  section('Indicateurs de la journée (hors TVA)');
  if (d.kpi) {
    const k = d.kpi;
    const rows: [string, string][] = [
      ['Chambres occupées / disponibles', `${k.roomsOccupied} / ${k.roomsAvailable}`],
      ["Taux d'occupation", `${(k.occupancyRate * 100).toFixed(1).replace('.', ',')} %`],
      ['ADR', fmtMoney(k.adr, d.currency)],
      ['RevPAR', fmtMoney(k.revpar, d.currency)],
      ['Revenu hébergement HT', fmtMoney(k.roomRevenue, d.currency)],
    ];
    for (const [a, b] of rows) { text(a, M, 10, font, MUTED); text(b, 300, 10, bold); y -= 15; }
  } else {
    text("Aucun KPI calculé pour cette date : lancer l'audit des KPI.", M, 10, font, AMBER);
    y -= 15;
  }

  section('Nuitées postées cette nuit');
  const p = d.posting;
  for (const [a, b] of [
    ['Nuitées postées', String(p.nights)],
    ['Total HT', fmtMoney(p.netTotal, d.currency)],
    ['TVA', fmtMoney(p.vatTotal, d.currency)],
    ['Total TTC', fmtMoney(p.grossTotal, d.currency)],
  ] as [string, string][]) { text(a, M, 10, font, MUTED); text(b, 300, 10, bold); y -= 15; }

  section(`Clients en séjour (${d.inHouse.length})`);
  if (!d.inHouse.length) { text('Aucun client en séjour.', M, 10, font, MUTED); y -= 15; }
  for (const r of d.inHouse) {
    need(16);
    text(r.room, M, 9, bold); text(r.guest, M + 50, 9); text(r.confirmation, 300, 9, font, MUTED); text(`départ ${r.departure}`, 450, 9, font, MUTED);
    y -= 14;
  }

  section(`Soldes à recouvrer (${d.debtors.length})`);
  if (!d.debtors.length) { text('Aucun folio ouvert avec solde positif.', M, 10, font, MUTED); y -= 15; }
  for (const r of d.debtors) {
    need(16);
    text(r.guest, M, 9); text(r.confirmation, 300, 9, font, MUTED);
    const amt = safe(fmtMoney(r.balance, d.currency));
    page.drawText(amt, { x: W - M - bold.widthOfTextAtSize(amt, 9), y, size: 9, font: bold, color: RED });
    y -= 14;
  }

  // Regroupe les anomalies de meme type pour garder un rapport lisible (ex. 17 alertes ADR identiques).
  const groups = new Map<string, { severity: string; title: string; items: string[] }>();
  for (const f of d.findings) {
    const key = `${f.severity}|${f.title}`;
    const g = groups.get(key) ?? { severity: f.severity, title: f.title, items: [] };
    g.items.push(f.description);
    groups.set(key, g);
  }
  section(`Anomalies ouvertes (${d.findings.length})`);
  if (!d.findings.length) { text('Aucune anomalie ouverte.', M, 10, font, MUTED); y -= 15; }
  for (const g of groups.values()) {
    const shown = g.items.slice(0, 3);
    const lines = shown.flatMap((t) => wrap(`- ${t}`, 8.5, W - 2 * M - 70));
    if (g.items.length > shown.length) lines.push(`... et ${g.items.length - shown.length} autre(s) du même type.`);
    need(14 + lines.length * 11 + 4);
    const color = g.severity === 'critical' ? RED : g.severity === 'warning' ? AMBER : MUTED;
    text(g.severity.toUpperCase(), M, 8, bold, color);
    const title = g.items.length > 1 ? `${g.title} (x${g.items.length})` : g.title;
    for (const t of wrap(title, 9.5, W - 2 * M - 70, bold)) { text(t, M + 70, 9.5, bold); y -= 12; }
    for (const l of lines) { text(l, M + 70, 8.5, font, MUTED); y -= 11; }
    y -= 5;
  }

  const pages = pdf.getPages();
  pages.forEach((pg, i) =>
    pg.drawText(safe(`${d.hotelName} - Night Audit ${d.businessDate} - page ${i + 1}/${pages.length}`), {
      x: M, y: 24, size: 7.5, font, color: MUTED,
    })
  );
  return pdf.save();
}
