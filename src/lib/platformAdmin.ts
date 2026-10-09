import type { SessionPayload } from '@/lib/session';

/**
 * Administrateur de la plateforme : seules les adresses listees dans PLATFORM_ADMIN_EMAILS (separees par des virgules) peuvent creer
 * ou supprimer des hotels de demonstration. Variable absente ou vide : fonction desactivee pour tout le monde (refus par defaut).
 * Ce n'est pas un role d'hotel : creer un tenant est une operation de plateforme, pas de gestion d'un etablissement.
 */
export function isPlatformAdmin(session: Pick<SessionPayload, 'email'> | null, env: string | undefined = process.env.PLATFORM_ADMIN_EMAILS): boolean {
  if (!session?.email || !env) return false;
  const allowed = env.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(session.email.trim().toLowerCase());
}
