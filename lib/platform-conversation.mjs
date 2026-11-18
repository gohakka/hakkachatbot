// Match Morari's page: explicit URL session, otherwise the first server session.
// force_new is reserved for the user's explicit New Conversation action.
/** @param {(...args: any[]) => Promise<any>} request @param {string|null} preferred */
export async function openPlatformConversation(request, preferred = null, forceNew = false) {
  const sessions = await request('sessions');
  const selected = forceNew ? null : preferred ?? sessions[0]?.session_id ?? null;
  const opened = await request('session', { session_id: selected, force_new: forceNew });
  return { sessionId: opened.session_id, sessions: sessions.some(s => s.session_id === opened.session_id) ? sessions : [{ session_id: opened.session_id, title: '新對話' }, ...sessions] };
}
export function platformMessageText(content) {
  return (content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('');
}
export function platformUserText(text) { return text.trim(); }
export const isSettled = status => ['completed', 'cancelled', 'interrupted', 'failed'].includes(status);
/** @param {() => Promise<{status:string}>} read @param {{signal?:AbortSignal, attempts?:number, sleep?:(ms:number)=>Promise<void>}} options */
export async function waitForPlatformRequest(read, { signal, attempts = 120, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let i = 0; i < attempts && !signal?.aborted; i++) {
    const request = await read();
    if (isSettled(request.status)) return request;
    if (i + 1 < attempts) await sleep(1000);
  }
  return null;
}
