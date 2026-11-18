// Server-only adapter. Account credentials and access tokens stay on the server.
type Env = { MORARI_USERNAME?: string; MORARI_PASSWORD?: string };
const BASE = 'https://3c.ouob.net/api/v1';
let cached: { token: string; expires: number; username: string } | null = null;
let loggingIn: Promise<string> | null = null;
async function token(env: Env, renew = false): Promise<string> {
  if (!env.MORARI_USERNAME || !env.MORARI_PASSWORD) throw new Error('尚未設定平台連線帳號。');
  if (!renew && cached && cached.expires > Date.now() && cached.username === env.MORARI_USERNAME) return cached.token;
  if (loggingIn) return loggingIn;
  loggingIn = (async () => {
    const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: env.MORARI_USERNAME, password: env.MORARI_PASSWORD }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('無法登入助理平台。');
    const d = await r.json() as { access_token: string };
    if (!d.access_token) throw new Error('平台登入回應不完整。');
    cached = { token: d.access_token, expires: Date.now() + 240000, username: env.MORARI_USERNAME! };
    return d.access_token;
  })();
  try { return await loggingIn; } finally { loggingIn = null; }
}
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(value); }
export async function morari(request: Request, env: Env): Promise<Response> {
  const u = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'POST') return reply({ error: '不支援此操作。' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== u.origin) return reply({ error: '不允許此來源。' }, 403);
  try {
    const body = request.method === 'POST' ? await request.json() as Record<string, unknown> : {};
    const sid = body.session_id ?? u.searchParams.get('session_id');
    let path: string;
    let payload: unknown;
    if (u.pathname === '/api/morari/session' && request.method === 'POST') {
      if (sid != null && !validId(sid)) return reply({ error: '對話編號無效。' }, 400);
      path = '/assistant/sessions'; payload = { session_id: sid ?? null, force_new: body.force_new === true };
    } else {
      if (!validId(sid)) return reply({ error: '請先建立對話。' }, 400);
      const root = `/assistant/sessions/${encodeURIComponent(sid)}`;
      if (u.pathname === '/api/morari/voice' && request.method === 'POST') {
        path = '/assistant/voice/token'; payload = { session_id: sid, voice_language: 'hak' };
      } else if (u.pathname === '/api/morari/history' && request.method === 'GET') {
        path = `${root}/messages?limit=100`;
      } else if (u.pathname === '/api/morari/stream' && request.method === 'POST') {
        if (!validId(body.request_id) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 8000) return reply({ error: '請輸入 1 至 8000 字的訊息。' }, 400);
        path = '/assistant/text/stream'; payload = { session_id: sid, request_id: body.request_id, text: body.text.trim() };
      } else if (u.pathname === '/api/morari/follow' && request.method === 'GET' && validId(u.searchParams.get('request_id'))) {
        path = `${root}/requests/${encodeURIComponent(u.searchParams.get('request_id')!)}/stream`;
      } else return reply({ error: '找不到此操作。' }, 404);
    }
    const upstream = async (renew = false) => fetch(`${BASE}${path}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${await token(env, renew)}`, 'Content-Type': 'application/json', Accept: path.includes('stream') ? 'text/event-stream' : 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(path.includes('stream') ? 240000 : 30000),
    });
    let response = await upstream();
    if (response.status === 401) { await response.body?.cancel(); response = await upstream(true); }
    if (!response.ok) { await response.body?.cancel(); return reply({ error: response.status === 429 ? '目前使用較頻繁，請稍候再試。' : '助理平台暫時無法完成請求，請稍後重試。' }, response.status >= 500 ? 502 : response.status); }
    return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (e) {
    return reply({ error: e instanceof SyntaxError ? '請求格式有誤。' : e instanceof Error && e.message.includes('尚未設定') ? e.message : '連線逾時或平台暫時無法使用，請再試一次。' }, 502);
  }
}
