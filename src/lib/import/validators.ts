import type { TargetEntityType } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEntity(
  entityType: TargetEntityType,
  data: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  if (entityType === 'guest') {
    if (!data.first_name) errors.push('first_name manquant');
    if (!data.last_name) errors.push('last_name manquant');
    if (data.email && !EMAIL_RE.test(String(data.email))) errors.push(`email invalide: ${data.email}`);
    if (data.vip_tier && !['none', 'silver', 'gold', 'platinum', 'diamond'].includes(String(data.vip_tier))) {
      errors.push(`vip_tier invalide: ${data.vip_tier}`);
    }
  }

  if (entityType === 'reservation') {
    if (!data.confirmation_number) errors.push('confirmation_number manquant');
    if (!data.guest_email || !EMAIL_RE.test(String(data.guest_email))) {
      errors.push(`guest_email manquant ou invalide: ${data.guest_email}`);
    }
    if (!data.arrival_date) errors.push('arrival_date manquant ou non reconnu');
    if (!data.departure_date) errors.push('departure_date manquant ou non reconnu');
    if (data.arrival_date && data.departure_date) {
      const arr = new Date(String(data.arrival_date));
      const dep = new Date(String(data.departure_date));
      if (dep <= arr) errors.push('departure_date doit être postérieure à arrival_date');
    }
    if (data.total_amount !== undefined && data.total_amount !== null && isNaN(Number(data.total_amount))) {
      errors.push(`total_amount invalide: ${data.total_amount}`);
    }
    if (
      data.status &&
      !['tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'].includes(String(data.status))
    ) {
      errors.push(`status inconnu: ${data.status} (sera forcé à "confirmed")`);
    }
  }

  return errors;
}
