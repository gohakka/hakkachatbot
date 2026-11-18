export async function* events(response) {
  if (!response.ok) {
    const d = await response.json().catch(() => ({}));
    throw new Error(d.error || '助理連線中斷，請再試一次。');
  }
  if (!response.body) throw new Error('平台沒有回傳資料。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        let name = 'message'; const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) { try { yield { name, data: JSON.parse(data.join('\n')) }; } catch { /* Ignore malformed server frames. */ } }
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
