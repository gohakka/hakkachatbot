export type SessionAccessEnv = { MORARI_PASSWORD?: string; MORARI_OWNER_EMAIL?: string };
const COOKIE = 'hani_conversation';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(id);
export function isPlatformOwner(request: Request, env: SessionAccessEnv) {
  // These identity headers are asserted by Sites dispatch, not accepted from visitors.
  return !!request.headers.get('oai-authenticated-user-id') && !!env.MORARI_OWNER_EMAIL && request.headers.get('oai-authenticated-user-email')?.toLowerCase() === env.MORARI_OWNER_EMAIL.toLowerCase();
}
async function key(env: SessionAccessEnv) {
  if (!env.MORARI_PASSWORD) throw new Error('尚未設定平台連線帳號。');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`hani-guest-session-v1:${env.MORARI_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function encode(bytes: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export async function guestSession(request: Request, env: SessionAccessEnv): Promise<string | null> {
  const value = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value) return null;
  const [id, expires, signature, extra] = value.split('.');
  if (!validId(id) || extra || !signature || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return null;
  try {
    const raw = atob(signature.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - signature.length % 4) % 4));
    const valid = await crypto.subtle.verify('HMAC', await key(env), Uint8Array.from(raw, c => c.charCodeAt(0)), new TextEncoder().encode(`${id}.${expires}`));
    return valid ? id : null;
  } catch { return null; }
}
export async function sessionCookie(id: string, env: SessionAccessEnv) {
  if (!validId(id)) throw new Error('平台對話編號無效。');
  const expires = Date.now() + 30 * 86400000;
  const payload = `${id}.${expires}`;
  const signature = encode(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(payload)));
  return `${COOKIE}=${payload}.${signature}; Path=/api/morari; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}
