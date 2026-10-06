import { STATUS_LABELS, VIP_LABELS } from '@/lib/formatters';

const CHIP = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium';

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { chip: string; dot: string }> = {
    tentative: { chip: 'bg-ink-800 text-ink-400', dot: 'bg-ink-500' },
    confirmed: { chip: 'bg-steel-tint text-steel-dim', dot: 'bg-steel' },
    checked_in: { chip: 'bg-moss-tint text-moss', dot: 'bg-moss' },
    checked_out: { chip: 'bg-ink-800 text-ink-400', dot: 'bg-ink-500' },
    cancelled: { chip: 'bg-wine-tint text-wine', dot: 'bg-wine' },
    no_show: { chip: 'bg-wine-tint text-wine', dot: 'bg-wine' },
  };
  const s = styles[status] ?? styles.tentative;
  return (
    <span className={`${CHIP} ${s.chip}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function VipBadge({ tier }: { tier: string }) {
  if (!tier || tier === 'none') return null;
  const styles: Record<string, string> = {
    silver: 'bg-ink-800 text-ink-400',
    gold: 'bg-brass-tint text-[#7A5F2B]',
    platinum: 'bg-steel-tint text-steel-dim',
    diamond: 'bg-navy text-brass-light',
  };
  return (
    <span className={`mt-1 ${CHIP} ${styles[tier] ?? 'bg-ink-800 text-ink-400'}`}>
      {VIP_LABELS[tier]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, { chip: string; label: string }> = {
    critical: { chip: 'bg-wine-tint text-wine', label: 'Critique' },
    warning: { chip: 'bg-ochre-tint text-ochre', label: 'Avertissement' },
    info: { chip: 'bg-ink-800 text-ink-400', label: 'Information' },
  };
  const s = styles[severity] ?? styles.info;
  return <span className={`${CHIP} ${s.chip}`}>{s.label}</span>;
}

export function severityBorder(severity: string): string {
  return severity === 'critical' ? 'border-l-wine' : severity === 'warning' ? 'border-l-ochre' : 'border-l-ink-600';
}
