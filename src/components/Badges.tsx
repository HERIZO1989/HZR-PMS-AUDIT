import { STATUS_LABELS, VIP_LABELS } from '@/lib/formatters';

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    tentative: 'text-ink-400 border-ink-600',
    confirmed: 'text-brass-light border-brass-dim',
    checked_in: 'text-moss border-moss',
    checked_out: 'text-ink-400 border-ink-600',
    cancelled: 'text-wine border-wine',
    no_show: 'text-wine border-wine',
  };
  return (
    <span className={`inline-block border px-2 py-0.5 text-xs ${styles[status] ?? 'border-ink-600 text-ink-400'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function VipBadge({ tier }: { tier: string }) {
  if (!tier || tier === 'none') return null;
  const styles: Record<string, string> = {
    silver: 'text-ink-400',
    gold: 'text-brass-light',
    platinum: 'text-parchment',
    diamond: 'text-brass',
  };
  return (
    <span className={`text-xs ${styles[tier] ?? 'text-ink-400'}`}>
      {VIP_LABELS[tier]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, { border: string; text: string; label: string }> = {
    critical: { border: 'border-l-wine', text: 'text-wine', label: 'Critique' },
    warning: { border: 'border-l-ochre', text: 'text-ochre', label: 'Avertissement' },
    info: { border: 'border-l-ink-600', text: 'text-ink-400', label: 'Information' },
  };
  const s = styles[severity] ?? styles.info;
  return <span className={`text-xs ${s.text}`}>{s.label}</span>;
}

export function severityBorder(severity: string): string {
  return severity === 'critical' ? 'border-l-wine' : severity === 'warning' ? 'border-l-ochre' : 'border-l-ink-600';
}
