'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface SeriesPoint {
  business_date: string;
  occupancy_rate: number;
  adr: number;
  revpar: number;
}

const COLORS = {
  occupancy: '#0E6FA0', // brass (bleu-petrole)
  adr: '#2F7D4F', // moss
  revpar: '#C0392B', // wine
  grid: '#E2E8EE', // ink-700
  axis: '#5B6B79', // ink-400
};

function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(iso));
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-ink-600 bg-ink-800 px-3 py-2 text-xs">
      <div className="mb-1 text-ink-400">{formatDateShort(label)}</div>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} style={{ color: entry.color }} className="tabular">
          {entry.name}: {entry.dataKey === 'occupancy_rate' ? `${(entry.value * 100).toFixed(1)}%` : `${entry.value.toFixed(0)} €`}
        </div>
      ))}
    </div>
  );
}

export function KpiTrendChart({ series, metric }: { series: SeriesPoint[]; metric: 'occupancy' | 'money' }) {
  if (series.length === 0) return null;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="business_date"
            tickFormatter={formatDateShort}
            stroke={COLORS.axis}
            tick={{ fontSize: 11, fill: COLORS.axis }}
            tickLine={false}
            axisLine={{ stroke: COLORS.grid }}
            minTickGap={24}
          />
          <YAxis
            stroke={COLORS.axis}
            tick={{ fontSize: 11, fill: COLORS.axis }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (metric === 'occupancy' ? `${Math.round(v * 100)}%` : `${Math.round(v)}€`)}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          {metric === 'occupancy' ? (
            <Line
              type="monotone"
              dataKey="occupancy_rate"
              name="Occupation"
              stroke={COLORS.occupancy}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ) : (
            <>
              <Line
                type="monotone"
                dataKey="adr"
                name="ADR"
                stroke={COLORS.adr}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="revpar"
                name="RevPAR"
                stroke={COLORS.revpar}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
