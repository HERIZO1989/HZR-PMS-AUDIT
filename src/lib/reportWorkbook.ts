import * as XLSX from 'xlsx';
import type { MonthlyReport } from './monthlyReport';

/** Classeur Excel du rapport mensuel : Synthèse, Dépenses, Créances, Points d'attention (montants HT, nombres réels avec formats). */
export function reportWorkbook(r: MonthlyReport, hotelName: string, currency: string): Buffer {
  const { month, previous, ytd } = r.kpi;
  const rows: [string, (number | null | undefined), (number | null | undefined), (number | null | undefined), string][] = [
    ['Occupation', month?.occupancy, previous?.occupancy, ytd.occupancy, '0.0%'],
    ['ADR', month?.adr, previous?.adr, ytd.adr, '#,##0'],
    ['RevPAR', month?.revpar, previous?.revpar, ytd.revpar, '#,##0'],
    ['TRevPAR', month?.trevpar, previous?.trevpar, ytd.trevpar, '#,##0'],
    ['CA facturé HT', month?.billedRevenue, previous?.billedRevenue, ytd.billedRevenue, '#,##0'],
    ['Revenu hébergement HT', month?.roomRevenue, previous?.roomRevenue, ytd.roomRevenue, '#,##0'],
    ['Dépenses HT', month?.expenses, previous?.expenses, ytd.expenses, '#,##0'],
    ['GOP', month?.gop, previous?.gop, ytd.gop, '#,##0'],
    ['Marge GOP', month?.gopMargin, previous?.gopMargin, ytd.gopMargin, '0.0%'],
    ['GOPPAR', month?.goppar, previous?.goppar, ytd.goppar, '#,##0'],
    ['Chambres-nuits disponibles', month?.roomsAvailable, previous?.roomsAvailable, ytd.roomsAvailable, '#,##0'],
    ['Nuits occupées', month?.roomsOccupied, previous?.roomsOccupied, ytd.roomsOccupied, '#,##0'],
  ];
  const wb = XLSX.utils.book_new();
  const head = [[`Rapport mensuel - ${hotelName}`], [`${r.label} · montants HT en ${currency === 'MGA' ? 'Ariary' : currency} · situation au ${r.asOf.split('-').reverse().join('/')}`], [], ['Indicateur', r.label, 'Mois précédent', 'Cumul de l\'année']];
  const ws1 = XLSX.utils.aoa_to_sheet([...head, ...rows.map((x) => [x[0], x[1] ?? null, x[2] ?? null, x[3] ?? null])]);
  rows.forEach((x, i) => (['B', 'C', 'D'] as const).forEach((c) => { const cell = ws1[`${c}${head.length + 1 + i}`]; if (cell && typeof cell.v === 'number') cell.z = x[4]; }));
  ws1['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Synthèse');

  const ws2 = XLSX.utils.aoa_to_sheet([['Catégorie', 'Montant HT', 'Part'], ...r.expensesByCategory.map((c) => [c.label, c.amountHt, c.share])]);
  r.expensesByCategory.forEach((_, i) => { ws2[`B${i + 2}`].z = '#,##0'; ws2[`C${i + 2}`].z = '0.0%'; });
  ws2['!cols'] = [{ wch: 52 }, { wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Dépenses');

  const rc = r.receivables;
  const ws3 = XLSX.utils.aoa_to_sheet([
    ['Créances (situation actuelle, TTC)', 'Montant'], ['Total', rc.total], ['Créances fiables', rc.reliable], ['À rapprocher (restaurant, buanderie)', rc.toReconcile], ['Échues', rc.overdue], ['Plus de 90 jours', rc.over90], [],
    ['Principaux clients', 'Factures', 'Total TTC', 'Plus de 90 jours', 'Plus ancienne'], ...rc.top.map((c) => [c.client, c.count, c.total, c.over90, c.oldest]),
  ]);
  ['B2', 'B3', 'B4', 'B5', 'B6'].forEach((a) => { ws3[a].z = '#,##0'; });
  rc.top.forEach((_, i) => { ws3[`C${9 + i}`].z = '#,##0'; ws3[`D${9 + i}`].z = '#,##0'; });
  ws3['!cols'] = [{ wch: 46 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Créances');

  const ws4 = XLSX.utils.aoa_to_sheet([["Points d'attention"], ...(r.attention.length ? r.attention.map((a) => [a]) : [['Aucun point d\'attention.']])]);
  ws4['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Points d'attention");
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
