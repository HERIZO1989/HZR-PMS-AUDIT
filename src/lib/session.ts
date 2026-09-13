import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE = 'pms_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h - duree typique d'un shift hotelier

export interface SessionPayload {
  staffUserId: string;
  tenantId: string;
  hotelId: string;
  displayName: string;
  email: string;
  permissions: string[];
  jti: string;
  iat: number;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET manquant ou trop court (32 caracteres minimum) dans les variables d'environnement");
  }
  return new TextEncoder().encode(secret);
}

/** Cree un jti unique pour cette session : necessaire pour pouvoir la revoquer individuellement (TASK 2 / BUG-06). */
export async function signSession(
  payload: Omit<SessionPayload, 'jti' | 'iat'>
): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
  return { token, jti };
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** A utiliser dans les Server Components / route handlers "classiques" (app router). */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** A utiliser dans les route handlers qui recoivent un NextRequest explicite. */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function hasPermission(session: SessionPayload | null, code: string): boolean {
  if (!session) return false;
  return session.permissions.includes('admin.full') || session.permissions.includes(code);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
};

/**
 * BUG-06 - Verifie la revocation via un appel direct a l'API REST Supabase (fetch, compatible
 * Edge Runtime pour le middleware). Utilise le service role car cette verification doit
 * fonctionner independamment de toute session utilisateur (poule/oeuf).
 */
export async function isSessionRevoked(jti: string, staffUserId: string, issuedAtEpochSeconds: number): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false; // config manquante : ne bloque pas toute l'app, mais ne devrait jamais arriver en prod

  try {
    const issuedAtIso = new Date(issuedAtEpochSeconds * 1000).toISOString();
    const res = await fetch(`${url}/rest/v1/rpc/is_session_valid`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_jti: jti, p_staff_user_id: staffUserId, p_issued_at: issuedAtIso }),
    });
    if (!res.ok) return true; // echec de la verification -> on refuse par prudence (fail-closed)
    const isValid = await res.json();
    return isValid !== true;
  } catch {
    return true; // erreur reseau -> fail-closed
  }
}
