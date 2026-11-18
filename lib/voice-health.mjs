// A text turn is not proof of audio delivery. Only check completed VOICE turns;
// intentionally interrupted turns and text-only requests must not cause resets.
export class VoiceHealth {
  turn = null;
  lastAttempt = -Infinity;
  attempts = 0;
  begin(id) { this.turn = { id, textAt: null, finishedAt: null, heard: false }; }
  text(id, now) { if (this.turn?.id === id && this.turn.textAt === null) this.turn.textAt = now; }
  heard(now) { if (this.turn?.textAt !== null && this.turn && now >= this.turn.textAt) { this.turn.heard = true; this.attempts = 0; } }
  finish(id, status, now) {
    if (this.turn?.id !== id) return;
    if (status === 'completed') this.turn.finishedAt ??= now;
    else if (['cancelled', 'interrupted', 'failed'].includes(status)) this.turn = null;
  }
  shouldRecover(now, { listening, muted, blocked, visible }) {
    const t = this.turn;
    if (!listening || muted || blocked || !visible || !t || t.heard || t.textAt === null || t.finishedAt === null) return false;
    return now - t.finishedAt >= 10000 && this.canAttempt(now);
  }
  canAttempt(now) { return now - this.lastAttempt >= 45000 && this.attempts < 2; }
  attempted(now) { this.lastAttempt = now; this.attempts++; this.turn = null; }
  reset() { this.turn = null; this.attempts = 0; this.lastAttempt = -Infinity; }
}
