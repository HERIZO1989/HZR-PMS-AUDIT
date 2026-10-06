'use client';

import { useState } from 'react';

interface PreviewRow {
  rowNumber: number;
  status: 'valid' | 'invalid';
  errors: string[];
  normalized: Record<string, unknown> | null;
}

interface StageResult {
  batchId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  preview: PreviewRow[];
}

export function ImportsClient({ hotelId, tenantId }: { hotelId: string; tenantId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceSystem, setSourceSystem] = useState('generic_csv');
  const [targetEntityType, setTargetEntityType] = useState<'reservation' | 'guest'>('reservation');
  const [staging, setStaging] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<StageResult | null>(null);
  const [applySummary, setApplySummary] = useState<{ imported: number; invalid: number; skipped: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  async function handleStage() {
    if (!file) return;
    setStaging(true);
    setError(null);
    setResult(null);
    setApplySummary(null);

    const form = new FormData();
    form.append('file', file);
    form.append('hotelId', hotelId);
    form.append('tenantId', tenantId);
    form.append('sourceSystem', sourceSystem);
    form.append('targetEntityType', targetEntityType);

    const res = await fetch('/api/imports', { method: 'POST', body: form });
    const data = await res.json();
    setStaging(false);
    if (!res.ok) return setError(data.error ?? 'Échec du traitement du fichier');
    setResult(data);
  }

  async function handleApply() {
    if (!result) return;
    setApplying(true);
    const res = await fetch(`/api/imports/${result.batchId}/apply`, { method: 'POST' });
    const data = await res.json();
    setApplying(false);
    if (!res.ok) return setError(data.error ?? "Échec de l'application du lot");
    setApplySummary(data);
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="page-title">Imports</h1>
        <p className="page-subtitle">CSV, TXT, Excel ou exports Opera, Protel et Odoo</p>
      </header>

      <div className="panel mb-6 flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            className="field"
          >
            <option value="generic_csv">Fichier générique</option>
            <option value="opera">Export Opera</option>
            <option value="protel">Export Protel</option>
            <option value="odoo">Export Odoo</option>
          </select>
          <select
            value={targetEntityType}
            onChange={(e) => setTargetEntityType(e.target.value as 'reservation' | 'guest')}
            className="field"
          >
            <option value="reservation">Réservations</option>
            <option value="guest">Clients</option>
          </select>
        </div>

        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="field cursor-pointer file:mr-4 file:cursor-pointer file:rounded-sm file:border-0 file:bg-steel-tint file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-steel-dim"
        />

        <button
          onClick={handleStage}
          disabled={!file || staging}
          className="btn-primary w-fit"
        >
          {staging ? 'Analyse en cours…' : 'Analyser le fichier'}
        </button>

        {error && <p role="alert" className="rounded-sm bg-wine-tint px-3 py-2 text-sm text-wine">{error}</p>}
      </div>

      {result && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-ink-400">
              <span className="text-parchment">{result.totalRows}</span> lignes ·{' '}
              <span className="text-moss">{result.validRows} valides</span> ·{' '}
              <span className="text-wine">{result.invalidRows} invalides</span>
            </div>
            <button
              onClick={handleApply}
              disabled={applying || result.validRows === 0 || !!applySummary}
              className="btn-primary"
            >
              {applying ? 'Import en cours…' : `Importer les ${result.validRows} lignes valides`}
            </button>
          </div>

          {applySummary && (
            <p role="status" className="mb-4 rounded-sm bg-moss-tint px-4 py-3 text-sm text-moss">
              {applySummary.imported} lignes importées, {applySummary.invalid} rejetées, {applySummary.skipped}{' '}
              ignorées.
            </p>
          )}

          <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ligne</th>
                <th>Statut</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {result.preview.map((row) => (
                <tr key={row.rowNumber}>
                  <td className="tabular text-ink-400">{row.rowNumber}</td>
                  <td className={`font-medium ${row.status === 'valid' ? 'text-moss' : 'text-wine'}`}>
                    {row.status === 'valid' ? 'Valide' : 'Invalide'}
                  </td>
                  <td className="break-all text-xs text-ink-400">
                    {row.status === 'valid' ? JSON.stringify(row.normalized) : row.errors.join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
