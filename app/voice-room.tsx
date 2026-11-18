'use client';

import { useEffect, useRef, useState } from 'react';
import { events } from '../lib/sse.mjs';

type Message = { id: string; role: 'user' | 'assistant'; text: string; partial?: boolean };
type RoomType = import('livekit-client').Room;
type Mode = 'idle' | 'connecting' | 'listening' | 'reconnecting';
type HistoryItem = { id: string; role: string; content: { type: string; text?: string }[] };
type ApiData = { error?: string; session_id: string; items?: HistoryItem[]; url: string; token: string };
const prompts = ['陪我用客語聊聊', '教我一句生活客語', '介紹客家美食'];
const notices: Record<string, string> = { translation_unavailable: '客語翻譯暫時無法使用，請稍候再試。', tts_hakka_unavailable: '客語語音暫時無法使用，請先看字幕。', stt_unavailable: '語音辨識暫時無法使用，請再說一次。', stt_warming: '語音辨識服務啟動中，請稍候再說。' };
function Icon({ name, ...props }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    mic: <><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
    mute: <><path d="m3 3 18 18M8 8v3a4 4 0 0 0 6.8 2.8M16 9V6a4 4 0 0 0-7-2.6M5 10v2a7 7 0 0 0 12 4.9M19 10v2M12 19v3m-4 0h8"/></>,
    chat: <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    send: <><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3"/></>,
    sound: <><path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></>,
    quiet: <><path d="m11 5-6 4H2v6h3l6 4V5ZM17 9l5 6m0-6-5 6"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  };
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.chat}</svg>;
}
async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/morari/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const d = await r.json() as ApiData; if (!r.ok) throw new Error(d.error || '無法連線至助理。'); return d;
}
export default function VoiceRoom() {
  const [mode, setMode] = useState<Mode>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const room = useRef<RoomType | null>(null);
  const session = useRef<string | null>(null);
  const creating = useRef<Promise<string> | null>(null);
  const generation = useRef(0);
  const changing = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLDivElement>(null);
  const bars = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(false);
  const meterCleanup = useRef<() => void>(() => {});
  const context = useRef<AudioContext | null>(null);
  const analysers = useRef<Map<string, AnalyserNode>>(new Map());
  const sources = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const controllers = useRef(new Set<AbortController>());
  const following = useRef(new Set<string>());
  const activeTurns = useRef(new Set<string>());
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; if(voiceTimer.current) clearTimeout(voiceTimer.current); controllers.current.forEach(c => c.abort()); room.current?.disconnect(); meterCleanup.current(); context.current?.close(); };
  }, []);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages, busy]);
  function upsert(message: Message) {
    setMessages(old => { const i = old.findIndex(m => m.id === message.id); return i < 0 ? [...old, message] : old.map((m, j) => j === i ? message : m); });
  }
  async function ensureSession() {
    if (session.current) return session.current;
    if (creating.current) return creating.current;
    creating.current = api('session', { force_new: true }).then(d => { session.current = d.session_id; return d.session_id as string; });
    try { return await creating.current; } finally { creating.current = null; }
  }
  async function syncHistory(sid: string, epoch: number) {
    const d = await api(`history?session_id=${encodeURIComponent(sid)}`);
    if (epoch !== generation.current || !mounted.current) return;
    const history: Message[] = (d.items ?? []).flatMap((m: { id: string; role: string; content: { type: string; text?: string }[] }) => {
      const value = (m.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').replace(/^請用客語回答以下訊息：\n/, '');
      return value ? [{ id: m.id, role: m.role === 'user' ? 'user' as const : 'assistant' as const, text: value }] : [];
    });
    // Replace optimistic turns only after every active stream has settled.
    if (activeTurns.current.size === 0 && history.length) setMessages(history);
  }
  async function consume(response: Response, requestId: string, sid: string, epoch: number) {
    let value = ''; let settled = false; const seen = new Set<string>();
    for await (const frame of events(response)) {
      if (epoch !== generation.current || !mounted.current) return true;
      const d = frame.data;
      if (frame.name === 'event') {
        const e = d.event ?? {};
        if (e.id && seen.has(e.id)) continue;
        if (e.id) seen.add(e.id);
        if (e.type === 'TEXT_BLOCK_DELTA') {
          value += e.delta ?? e.text ?? '';
          upsert({ id: `reply-${requestId}`, role: 'assistant', text: value, partial: true });
        } else if (e.type === 'REPLY_NOTICE') setError(notices[e.kind] || '助理服務暫時無法使用。');
      }
      if (frame.name === 'final' || frame.name === 'accepted') {
        if (['completed', 'cancelled', 'interrupted', 'failed'].includes(d.status)) {
          settled = true;
          if (d.status === 'failed') setError('助理這次未能完成回覆，請再試一次。');
        }
      }
    }
    if (epoch === generation.current && value) upsert({ id: `reply-${requestId}`, role: 'assistant', text: value });
    return settled;
  }
  async function runTurn(requestId: string, sid: string, initial?: string) {
    if (following.current.has(requestId)) return;
    following.current.add(requestId); activeTurns.current.add(requestId); setBusy(true);
    const epoch = generation.current; const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch(initial === undefined ? `/api/morari/follow?session_id=${encodeURIComponent(sid)}&request_id=${encodeURIComponent(requestId)}` : '/api/morari/stream', {
        ...(initial !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sid, request_id: requestId, text: initial }) } : {}), signal: controller.signal,
      });
      const done = await consume(response, requestId, sid, epoch);
      if (!done && epoch === generation.current && !controller.signal.aborted) {
        const follow = await fetch(`/api/morari/follow?session_id=${encodeURIComponent(sid)}&request_id=${encodeURIComponent(requestId)}`, { signal: controller.signal });
        const finished = await consume(follow, requestId, sid, epoch);
        if (!finished) throw new Error('回覆連線中斷，可在原平台查看完整紀錄。');
      }
    } catch(e) { if (!controller.signal.aborted && epoch === generation.current) setError(e instanceof Error ? e.message : '回覆連線中斷，請再試一次。'); }
    finally {
      controllers.current.delete(controller); following.current.delete(requestId); activeTurns.current.delete(requestId);
      if (epoch === generation.current && mounted.current) { setBusy(activeTurns.current.size > 0); syncHistory(sid, epoch).catch(() => setError('字幕同步暫時中斷，已接收的字幕仍會保留。')); }
    }
  }
  async function send(value: string) {
    if (!value.trim() || sending || changing.current) return;
    setSending(true); setError('');
    try { const sid = await ensureSession(); const id = crypto.randomUUID(); upsert({ id: `user-${id}`, role: 'user', text: value.trim() }); setText(''); await runTurn(id, sid, `請用客語回答以下訊息：\n${value.trim()}`); }
    catch(e) { setError(e instanceof Error ? e.message : '傳送失敗，請再試一次。'); }
    finally { if(mounted.current) setSending(false); }
  }
  function attachMeter(track: MediaStreamTrack) {
    if (!context.current || analysers.current.has(track.id)) return;
    const source = context.current.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.current.createAnalyser(); analyser.fftSize = 256;
    source.connect(analyser); analysers.current.set(track.id, analyser); sources.current.set(track.id,source);
    track.addEventListener('ended', () => { source.disconnect(); analysers.current.delete(track.id); sources.current.delete(track.id); }, { once: true });
  }
  function startMeter() {
    meterCleanup.current(); let frame = 0; let last = 0; let smooth = 0;
    const sample = new Uint8Array(256);
    const tick = (time: number) => {
      let level = 0;
      for(const analyser of analysers.current.values()) { analyser.getByteTimeDomainData(sample); let sum = 0; for(const v of sample) sum += ((v-128)/128)**2; level = Math.max(level, Math.min(1, Math.sqrt(sum/sample.length)*6)); }
      smooth = smooth*.65 + level*.35;
      orb.current?.style.setProperty('--level', String(smooth));
      if (bars.current) Array.from(bars.current.children).forEach((bar,i) => (bar as HTMLElement).style.height = `${4 + smooth * (10+18*Math.abs(Math.sin(i*.9+time/260)))}px`);
      if (time-last>150) { setMicActive(smooth>.08); last=time; }
      frame=requestAnimationFrame(tick);
    }; frame=requestAnimationFrame(tick);
    meterCleanup.current=()=>{cancelAnimationFrame(frame);sources.current.forEach(s=>s.disconnect());sources.current.clear();analysers.current.clear();orb.current?.style.setProperty('--level','0');bars.current?.querySelectorAll('i').forEach(b=>b.style.height='4px');};
  }
  async function toggleMic() {
    if (changing.current) return;
    changing.current=true; setError('');
    try {
      const sdk=await import('livekit-client');
      if(room.current && room.current.state === sdk.ConnectionState.Connected) {
        const on=!room.current.localParticipant.isMicrophoneEnabled;
        await room.current.localParticipant.setMicrophoneEnabled(on); setMode(on?'listening':'idle');
        if(on) { const track=room.current.localParticipant.getTrackPublication(sdk.Track.Source.Microphone)?.track?.mediaStreamTrack; if(track) attachMeter(track); }
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('此瀏覽器無法使用麥克風，請使用 HTTPS 或本機 localhost 開啟。');
      setMode('connecting');
      // Resume AudioContext during the user's gesture; browser owns microphone permission.
      context.current ??= new AudioContext(); await context.current.resume();
      const sid=await ensureSession();
      const d=await api('voice',{session_id:sid});
      const r=new sdk.Room({adaptiveStream:true,dynacast:true,audioCaptureDefaults:{echoCancellation:true,noiseSuppression:false,autoGainControl:true}});
      room.current=r;
      const epoch=generation.current;
      const current=()=>epoch===generation.current && room.current===r && mounted.current;
      const agentReady=()=>{if(voiceTimer.current)clearTimeout(voiceTimer.current);voiceTimer.current=null;};
      r.on(sdk.RoomEvent.TrackSubscribed,track=>{if(!current()||track.kind!==sdk.Track.Kind.Audio)return;const element=track.attach();element.autoplay=true;element.muted=mutedRef.current;audio.current?.appendChild(element);element.play().catch(()=>setAudioBlocked(true));attachMeter(track.mediaStreamTrack);});
      r.on(sdk.RoomEvent.TrackUnsubscribed,track=>{track.detach().forEach(el=>el.remove());const id=track.mediaStreamTrack.id;analysers.current.delete(id);sources.current.get(id)?.disconnect();sources.current.delete(id);});
      r.on(sdk.RoomEvent.TranscriptionReceived,(segments,participant)=>{if(!current()||!participant?.isLocal)return;for(const segment of segments)if(segment.text)upsert({id:'local-draft',role:'user',text:segment.text,partial:!segment.final});});
      r.on(sdk.RoomEvent.ActiveSpeakersChanged,participants=>{if(current())setSpeaking(participants.some(p=>!p.isLocal));});
      r.on(sdk.RoomEvent.ParticipantConnected,p=>{if(p.isAgent)agentReady();});
      r.on(sdk.RoomEvent.Reconnecting,()=>{if(current())setMode('reconnecting');});
      r.on(sdk.RoomEvent.Reconnected,()=>{if(current())setMode(r.localParticipant.isMicrophoneEnabled?'listening':'idle');});
      r.on(sdk.RoomEvent.Disconnected,()=>{if(!current())return;agentReady();room.current=null;setMode('idle');setSpeaking(false);setMicActive(false);meterCleanup.current();audio.current?.replaceChildren();setError('語音連線已結束，按麥克風即可重新連線。');});
      r.registerTextStreamHandler('morari.voice.events',async reader=>{
        const raw=await reader.readAll();if(!current())return;
        try {const e=JSON.parse(raw);if(e.session_id!==sid)return;
          if(e.type==='voice_error'){setError(notices[e.kind]||'這次語音未能辨識，請再說一次。');return;}
          if(e.type==='final_transcript'&&e.request_id&&e.text){setMessages(old=>old.filter(m=>m.id!=='local-draft'));upsert({id:`user-${e.request_id}`,role:'user',text:e.text});void runTurn(e.request_id,sid);}
        } catch {setError('無法讀取語音字幕，請再試一次。');}
      });
      await r.connect(d.url,d.token);if(!current()){await r.disconnect();return;}
      await r.startAudio().catch(()=>setAudioBlocked(true));
      await r.localParticipant.setMicrophoneEnabled(true);
      const track=r.localParticipant.getTrackPublication(sdk.Track.Source.Microphone)?.track?.mediaStreamTrack;
      startMeter();
      if(track)attachMeter(track);
      r.remoteParticipants.forEach(p=>p.audioTrackPublications.forEach(pub=>{if(pub.track)attachMeter(pub.track.mediaStreamTrack);}));
      setMode('listening');
      if(![...r.remoteParticipants.values()].some(p=>p.isAgent))voiceTimer.current=setTimeout(()=>{if(current())setError('助理仍在準備中；若持續沒有回應，請暫停後重新開啟麥克風。');},20000);
    } catch(e) {
      const r=room.current;room.current=null;await r?.disconnect();meterCleanup.current();audio.current?.replaceChildren();setMode('idle');setSpeaking(false);
      setError(e instanceof Error && e.name==='NotAllowedError'?'麥克風權限尚未開啟，請在瀏覽器允許麥克風後重試。':e instanceof Error?e.message:'語音連線失敗，請再試一次。');
    } finally {changing.current=false;}
  }
  async function newConversation() {
    if(changing.current||sending||busy)return;
    changing.current=true;generation.current++;if(voiceTimer.current)clearTimeout(voiceTimer.current);
    controllers.current.forEach(c=>c.abort());activeTurns.current.clear();following.current.clear();
    const old=room.current;room.current=null;await old?.disconnect();meterCleanup.current();audio.current?.replaceChildren();
    session.current=null;setMessages([]);setError('');setMode('idle');setBusy(false);setSpeaking(false);setMicActive(false);setAudioBlocked(false);changing.current=false;
  }
  function toggleSound(){const next=!muted;setMuted(next);mutedRef.current=next;audio.current?.querySelectorAll('audio').forEach(el=>{el.muted=next;});}
  async function unlockAudio(){await room.current?.startAudio();await context.current?.resume();setAudioBlocked(false);}
  const status=mode==='connecting'?'正在連接客語助理…':mode==='reconnecting'?'正在重新連線…':speaking?'助理說話中':mode==='listening'?(micActive?'聽著你講…':'麥克風已開啟，請開始說話'):busy?'助理正在思考…':'準備好了，來聊聊天';
  return <div className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="客語共下講首頁"><span className="brandmark">客</span><div><div className="brandname">共下講</div><small>HAKKA VOICE COMPANION</small></div></a><div className="navmeta"><span className="language">客語對話</span><span>讓熟悉的語言，陪你聊聊日常</span></div></header>
    <main className="layout"><section className="voice-side" aria-label="語音對話控制"><div className="eyebrow">A LITTLE CONVERSATION, IN HAKKA</div><h1>用客語，<br/><span>講你想講的。</span></h1><p className="intro">一聲問候、一段日常，都可以從這裡開始。<br/>按下麥克風，讓我們陪你慢慢聊。</p>
      <div ref={orb} className={`orb-stage ${micActive||speaking?'is-active':''}`} aria-hidden={false}><span className="orbit"/><span className="orbit"/><span className="orbit"/><span className="orb-glow"/><span className="ripple"/><span className="ripple delay"/><span className="orbit-dot"/><button className={`mic ${mode==='listening'?'on':''}`} onClick={toggleMic} disabled={mode==='connecting'||mode==='reconnecting'} aria-pressed={mode==='listening'} aria-label={mode==='listening'?'暫停麥克風':'開啟麥克風，開始客語對話'}><Icon name={mode==='listening'?'mute':'mic'}/><span>{mode==='connecting'?'連線中':mode==='listening'?'點一下暫停':'點一下開始'}</span></button></div>
      <div className="voice-status" role="status"><span className={`status-light ${mode==='listening'||speaking?'active':''}`}/>{status}</div><div ref={bars} className="wave-bars" aria-hidden="true">{Array.from({length:23},(_,i)=><i key={i}/>)}</div><p className="hint">{mode==='listening'?'說完稍停，助理就會回應你':'開啟後可持續對話，再按一次即可暫停'}</p><div className="voice-footer"><span><Icon name="mic"/>預設客語</span><span><Icon name="chat"/>即時對話字幕</span><span><Icon name="shield"/>由 Morari 助理提供服務</span></div>
    </section><section className="chat-panel" aria-label="對話字幕"><header className="chat-header"><div className="chat-title"><Icon name="chat"/>對話字幕<small>即時</small></div><div style={{display:'flex',gap:8}}><button className="icon-btn" onClick={toggleSound} aria-label={muted?'開啟助理聲音':'靜音助理聲音'} aria-pressed={muted}><Icon name={muted?'quiet':'sound'}/></button><button className="icon-btn" disabled={sending||busy||mode==='connecting'||mode==='reconnecting'} onClick={newConversation}><Icon name="plus"/>新對話</button></div></header>
      <div className="chat-scroll" ref={scroll} role="log" aria-label="對話紀錄" aria-live="polite" aria-relevant="additions text"><div className="date-rule">從一句問候開始</div>{messages.length===0?<div className="message"><div className="message-label"><span className="mini-avatar">客</span>客語助理</div><div className="bubble"><div className="welcome-emblem" aria-hidden="true">✳</div><p className="welcome-title">你好，歡迎來到共下講。</p><p className="welcome-copy">想練習客語，還是找個伴聊聊？<br/>按下左邊的麥克風，說說今天的心情。<br/>你說的話和助理的回覆，都會出現在這裡。</p></div><div className="suggestions">{prompts.map(p=><button key={p} disabled={sending} onClick={()=>send(p)}>{p}</button>)}</div></div>:messages.map(m=><article key={m.id} className={`message ${m.role} ${m.partial?'partial':''}`}><div className="message-label">{m.role==='assistant'&&<span className="mini-avatar">客</span>}{m.role==='user'?'你':'客語助理'}{m.partial&&<span>・{m.role==='user'?'辨識中':'回覆中'}</span>}</div><div className="bubble">{m.text}</div></article>)}{busy&&<div className="thinking" role="status" aria-label="助理正在回覆"><i/><i/><i/></div>}</div>
      {error&&<div className="error" role="alert">{error}</div>}{audioBlocked&&<button className="audio-unlock" onClick={()=>unlockAudio().catch(()=>setError('請檢查瀏覽器的聲音播放權限。'))}>點一下，開啟助理聲音</button>}<div className="chat-bottom"><form className="inputbox" onSubmit={e=>{e.preventDefault();void send(text);}}><label htmlFor="message" className="sr-only">輸入文字訊息</label><input id="message" value={text} onChange={e=>setText(e.target.value)} maxLength={7900} placeholder="也可以打字，和助理聊聊…" disabled={sending}/><button type="submit" aria-label="傳送訊息" disabled={!text.trim()||sending}><Icon name="send"/></button></form><p className="input-meta">語音與文字皆連接同一段對話 · 預設客語回覆</p></div>
    </section></main><p className="bottom-note">語音及訊息由 Morari 平台處理 · AI 回覆可能有誤，請依實際情況確認</p><div ref={audio} className="replay-audio"/>
  </div>;
}
