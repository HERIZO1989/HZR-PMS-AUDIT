export function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

export function formatPercent(rate: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1 }).format(rate);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export const STATUS_LABELS: Record<string, string> = {
  tentative: 'Provisoire',
  confirmed: 'Confirmée',
  checked_in: 'En séjour',
  checked_out: 'Partie',
  cancelled: 'Annulée',
  no_show: 'No-show',
};

export const VIP_LABELS: Record<string, string> = {
  none: '',
  silver: 'Argent',
  gold: 'Or',
  platinum: 'Platine',
  diamond: 'Diamant',
};
