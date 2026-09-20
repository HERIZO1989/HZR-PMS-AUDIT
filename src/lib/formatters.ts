// Symboles courts pour les devises dont le rendu Intl.NumberFormat n'est pas fiable
// selon les données ICU du navigateur (ex: MGA rend parfois "159 000 MGA" au lieu de "159 000 Ar").
const CURRENCY_SYMBOLS: Record<string, string> = { MGA: 'Ar' };

export function formatCurrency(amount: number, currency = 'EUR'): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (symbol) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount)} ${symbol}`;
  }
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

export function getCurrencySymbol(currency = 'EUR'): string {
  return CURRENCY_SYMBOLS[currency] ?? new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value ?? currency;
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
