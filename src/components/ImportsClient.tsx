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
    <div className="max-w-3xl">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-parchment">Imports</h1>
        <p className="mt-1 text-sm text-ink-400">CSV, TXT, Excel ou exports Opera / Protel</p>
      </header>

      <div className="mb-8 flex flex-col gap-4 border border-ink-700 p-5">
        <div className="flex gap-4">
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            className="border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-parchment"
          >
            <option value="generic_csv">Fichier générique</option>
            <option value="opera">Export Opera</option>
            <option value="protel">Export Protel</option>
          </select>
          <select
            value={targetEntityType}
            onChange={(e) => setTargetEntityType(e.target.value as 'reservation' | 'guest')}
            className="border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-parchment"
          >
            <option value="reservation">Réservations</option>
            <option value="guest">Clients</option>
          </select>
        </div>

        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink-400"
        />

        <button
          onClick={handleStage}
          disabled={!file || staging}
          className="w-fit border border-brass-dim px-4 py-2 text-sm text-brass-light hover:border-brass hover:text-brass disabled:opacity-50"
        >
          {staging ? 'Analyse en cours…' : 'Analyser le fichier'}
        </button>

        {error && <p className="text-sm text-wine">{error}</p>}
      </div>

      {result && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm text-ink-400">
              <span className="text-parchment">{result.totalRows}</span> lignes ·{' '}
              <span className="text-moss">{result.validRows} valides</span> ·{' '}
              <span className="text-wine">{result.invalidRows} invalides</span>
            </div>
            <button
              onClick={handleApply}
              disabled={applying || result.validRows === 0 || !!applySummary}
              className="border border-brass-dim px-4 py-2 text-sm text-brass-light hover:border-brass hover:text-brass disabled:opacity-50"
            >
              {applying ? 'Import en cours…' : `Importer les ${result.validRows} lignes valides`}
            </button>
          </div>

          {applySummary && (
            <p className="mb-4 border border-moss px-4 py-3 text-sm text-moss">
              {applySummary.imported} lignes importées, {applySummary.invalid} rejetées, {applySummary.skipped}{' '}
              ignorées.
            </p>
          )}

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-ink-700 text-left text-ink-400">
                <th className="py-2 pr-4 font-normal">Ligne</th>
                <th className="py-2 pr-4 font-normal">Statut</th>
                <th className="py-2 pr-4 font-normal">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {result.preview.map((row) => (
                <tr key={row.rowNumber}>
                  <td className="py-2 pr-4 tabular text-ink-400">{row.rowNumber}</td>
                  <td className={`py-2 pr-4 ${row.status === 'valid' ? 'text-moss' : 'text-wine'}`}>
                    {row.status === 'valid' ? 'Valide' : 'Invalide'}
                  </td>
                  <td className="py-2 pr-4 text-ink-400">
                    {row.status === 'valid' ? JSON.stringify(row.normalized) : row.errors.join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
