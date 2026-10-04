import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderNightAuditPdf, fmtMoney, type NightAuditReportData } from '../src/lib/reports/nightAuditReport';

const base: NightAuditReportData = {
  hotelName: 'Hôtel Anjary',
  currency: 'MGA',
  businessDate: '2026-10-03',
  generatedAt: '2026-10-04T15:27:00.000Z',
  kpi: { roomsAvailable: 120, roomsOccupied: 3, occupancyRate: 0.025, adr: 146666.67, revpar: 3666.67, roomRevenue: 440000 },
  posting: { nights: 3, netTotal: 440000, vatTotal: 88000, grossTotal: 528000 },
  inHouse: [
    { confirmation: 'RES-2026-d1bf00ca4b', guest: 'Ny Tiko RAKOTOARISOA', room: '205', departure: '2026-10-05' },
    { confirmation: 'RES-2026-e2971f6f56', guest: 'Hertahiana RAKOTOARISOA', room: '729', departure: '2026-10-08' },
  ],
  debtors: [{ confirmation: 'RES-2026-07d30fdc19', guest: 'Ny Aro RAKOTOARISOA', balance: 1930000 }],
  findings: [
    { severity: 'critical', title: 'Facture non soldée après départ', description: 'Folio FOL-20260920 ouvert avec un solde de 1930000.00 MGA.' },
    ...Array.from({ length: 17 }, (_, i) => ({
      severity: 'warning', title: 'Anomalie tarifaire (ADR)', description: `ADR du 2026-09-${String(i + 4).padStart(2, '0')} = 0.00 MGA contre une moyenne de 154761.90 MGA.`,
    })),
  ],
};

describe('Rapport Night Audit PDF', () => {
  it('formate les montants sans espace insecable', () => {
    expect(fmtMoney(1930000, 'MGA')).toBe('1 930 000 MGA');
    expect(fmtMoney(160833.33, 'MGA')).toBe('160 833,33 MGA');
    expect(fmtMoney(-318000, 'MGA')).toBe('-318 000 MGA');
    expect(fmtMoney(1234, 'MGA')).not.toMatch(/[\u202F\u00A0]/);
  });

  it('genere un PDF valide avec donnees completes', async () => {
    const bytes = await renderNightAuditPdf(base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('ne plante pas sans KPI, sans clients et avec caracteres hors WinAnsi', async () => {
    const bytes = await renderNightAuditPdf({
      ...base, kpi: null, inHouse: [], debtors: [], findings: [],
      hotelName: 'Hôtel « Anjary » ✓ 日本', businessDate: '2026-10-03',
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('pagine quand le contenu depasse une page', async () => {
    const many = { ...base, inHouse: Array.from({ length: 120 }, (_, i) => ({ ...base.inHouse[0], room: String(100 + i) })) };
    const bytes = await renderNightAuditPdf(many);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const single = await PDFDocument.load(await renderNightAuditPdf(base));
    expect(single.getPageCount()).toBe(1);
  });
});
