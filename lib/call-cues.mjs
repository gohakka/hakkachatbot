// A short, pre-rendered cue must never leave call setup waiting indefinitely.
export function playCallCue(element, source, onPlaying = () => {}, timeoutMs = 8000) {
  let finish;
  let finished = false;
  let timer;
  const done = new Promise(resolve => { finish = resolve; });
  const settle = played => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    element.removeEventListener('ended', ended);
    element.removeEventListener('error', error);
    element.removeEventListener('playing', playing);
    element.pause();
    finish(played);
  };
  const ended = () => settle(true);
  const error = () => settle(false);
  const playing = () => { if (!finished) onPlaying(); };
  element.addEventListener('ended', ended);
  element.addEventListener('error', error);
  element.addEventListener('playing', playing);
  element.src = source;
  timer = setTimeout(error, timeoutMs);
  try { Promise.resolve(element.play()).catch(error); } catch { error(); }
  return { done, stop: error };
}
