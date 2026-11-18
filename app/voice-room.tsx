'use client';

import { useEffect, useRef, useState } from 'react';
import { events } from '../lib/sse.mjs';
import { VoiceHealth } from '../lib/voice-health.mjs';
import { playCallCue } from '../lib/call-cues.mjs';

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
    phone: <path d="M7.2 3H4.8C3.8 3 3 3.8 3 4.8A16.2 16.2 0 0 0 19.2 21c1 0 1.8-.8 1.8-1.8v-2.4c0-.8-.5-1.5-1.3-1.7l-2.7-.8c-.6-.2-1.3 0-1.7.4l-1.2 1.2a13 13 0 0 1-6-6l1.2-1.2c.4-.4.6-1.1.4-1.7l-.8-2.7C8.7 3.5 8 3 7.2 3Z"/>,
    hangup: <path d="M3 15v-3c0-.5.2-1 .7-1.3a16 16 0 0 1 16.6 0c.5.3.7.8.7 1.3v3c0 .6-.5 1-1 1h-3c-.6 0-1-.4-1-1v-2a13 13 0 0 0-8 0v2c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1Z"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
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
  const [voiceNotice, setVoiceNotice] = useState('');
  const [canRepair, setCanRepair] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [cueSpeaking, setCueSpeaking] = useState(false);
  const [farewell, setFarewell] = useState(false);
  const cueAudio = useRef<HTMLAudioElement>(null);
  const cueStop = useRef<() => void>(() => {});
  const helloPlayed = useRef(false);
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
  const blockedRef = useRef(false);
  const voiceWanted = useRef(false);
  const health = useRef(new VoiceHealth());
  const restoreVoice = useRef<() => void>(() => {});
  const modeRef = useRef<Mode>('idle');
  modeRef.current = mode;
  const remoteTracks = useRef(new Set<string>());
  const remoteEnergy = useRef(new Map<string, number>());
  const healthBusy = useRef(false);
  const meterCleanup = useRef<() => void>(() => {});
  const context = useRef<AudioContext | null>(null);
  const analysers = useRef<Map<string, AnalyserNode>>(new Map());
  const sources = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const controllers = useRef(new Set<AbortController>());
  const following = useRef(new Set<string>());
  const activeTurns = useRef(new Set<string>());
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(()=>{
    if(!callActive || callStartedAt===null)return;
    const update=()=>setElapsed(Math.floor((Date.now()-callStartedAt)/1000));update();
    const timer=setInterval(update,1000);return ()=>clearInterval(timer);
  },[callActive,callStartedAt]);
  useEffect(() => {
    mounted.current = true;
    void playCue('hello');
    return () => { mounted.current = false; cueStop.current();voiceWanted.current=false; generation.current++; if(voiceTimer.current) clearTimeout(voiceTimer.current); controllers.current.forEach(c => c.abort()); room.current?.disconnect(); meterCleanup.current(); context.current?.close(); };
  }, []);
  useEffect(() => {
    const timer=setInterval(async()=>{
      if(healthBusy.current || !room.current || !voiceWanted.current || changing.current || document.visibilityState!=='visible')return;
      healthBusy.current=true;
      const currentRoom=room.current;
      try {
        // RTP energy still works when requestAnimationFrame is throttled.
        for(const participant of currentRoom.remoteParticipants.values()) for(const publication of participant.audioTrackPublications.values()) {
          const track=publication.track;
          if(!track)continue;
          const stats=await (track as import('livekit-client').RemoteAudioTrack).getReceiverStats();
          if(room.current!==currentRoom)return;
          const energy=stats?.totalAudioEnergy;
          if(typeof energy==='number') {
            const before=remoteEnergy.current.get(track.mediaStreamTrack.id);
            if(before!==undefined && energy-before>0.00001)health.current.heard(Date.now());
            remoteEnergy.current.set(track.mediaStreamTrack.id,energy);
          }
        }
        if(health.current.shouldRecover(Date.now(),{listening:modeRef.current==='listening',muted:mutedRef.current,blocked:blockedRef.current,visible:true}))restoreVoice.current();
      } catch { /* A receiver can disappear while a track is being replaced. */ }
      finally {healthBusy.current=false;}
    },2000);
    return ()=>clearInterval(timer);
  },[]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages, busy, showSubtitles]);
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
          health.current.text(requestId,Date.now());
          value += e.delta ?? e.text ?? '';
          upsert({ id: `reply-${requestId}`, role: 'assistant', text: value, partial: true });
        } else if (e.type === 'REPLY_NOTICE') setError(notices[e.kind] || '助理服務暫時無法使用。');
      }
      if (frame.name === 'final' || frame.name === 'accepted') {
        if (['completed', 'cancelled', 'interrupted', 'failed'].includes(d.status)) {
          if(typeof d.reply==='string'&&d.reply.trim())health.current.text(requestId,Date.now());
          health.current.finish(requestId,d.status,Date.now());
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
      for(const [id,analyser] of analysers.current) { analyser.getByteTimeDomainData(sample); let sum = 0; for(const v of sample) sum += ((v-128)/128)**2; const rms=Math.sqrt(sum/sample.length); level = Math.max(level, Math.min(1, rms*6)); if(remoteTracks.current.has(id)&&rms>.003)health.current.heard(Date.now()); }
      smooth = smooth*.65 + level*.35;
      orb.current?.style.setProperty('--level', String(smooth));
      if (bars.current) Array.from(bars.current.children).forEach((bar,i) => (bar as HTMLElement).style.height = `${4 + smooth * (10+18*Math.abs(Math.sin(i*.9+time/260)))}px`);
      if (time-last>150) { setMicActive(smooth>.08); last=time; }
      frame=requestAnimationFrame(tick);
    }; frame=requestAnimationFrame(tick);
    meterCleanup.current=()=>{cancelAnimationFrame(frame);sources.current.forEach(s=>s.disconnect());sources.current.clear();analysers.current.clear();orb.current?.style.setProperty('--level','0');bars.current?.querySelectorAll('i').forEach(b=>b.style.height='4px');};
  }
  function blocked(value: boolean) { blockedRef.current=value;setAudioBlocked(value); }
  async function resumePlayback() {
    await context.current?.resume();
    const r=room.current;
    if(!r)return;
    await r.startAudio();
    const elements=audio.current?.querySelectorAll('audio')??[];
    await Promise.all(Array.from(elements,el=>{el.muted=mutedRef.current;return el.play();}));
    blocked(!r.canPlaybackAudio);
  }
  async function playCue(kind: 'hello' | 'goodbye') {
    cueStop.current();
    const element=cueAudio.current;
    if(!element)return;
    element.muted=mutedRef.current;
    const cue=playCallCue(element,`/audio/hani-${kind}.wav`,()=>{
      if(kind==='hello')helloPlayed.current=true;
      if(mounted.current)setCueSpeaking(true);
    });
    cueStop.current=cue.stop;
    await cue.done;
    if(mounted.current)setCueSpeaking(false);
  }
  async function toggleMic(repair = false) {
    if (changing.current) return;
    changing.current=true; setError('');
    const wanted=repair?voiceWanted.current:true;
    const hello=(!repair&&!room.current&&!helloPlayed.current)?playCue('hello'):Promise.resolve();
    if(!repair)setFarewell(false);
    try {
      // Run before waiting for imports/network, while the user gesture is active.
      context.current ??= new AudioContext(); await context.current.resume();
      if(repair) {
        setMode('reconnecting');setVoiceNotice('正在恢復語音，對話字幕會保留…');
        health.current.attempted(Date.now());
        if(voiceTimer.current)clearTimeout(voiceTimer.current);
        const old=room.current;room.current=null;
        await old?.disconnect();meterCleanup.current();audio.current?.replaceChildren();
        remoteTracks.current.clear();remoteEnergy.current.clear();setSpeaking(false);
      }
      const sdk=await import('livekit-client');
      if(room.current && room.current.state === sdk.ConnectionState.Connected) {
        const on=!room.current.localParticipant.isMicrophoneEnabled;
        await room.current.localParticipant.setMicrophoneEnabled(on); voiceWanted.current=on;setMode(on?'listening':'idle');
        if(!on)health.current.turn=null;
        await resumePlayback().catch(()=>blocked(true));
        if(on) { const track=room.current.localParticipant.getTrackPublication(sdk.Track.Source.Microphone)?.track?.mediaStreamTrack; if(track) attachMeter(track); }
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('此瀏覽器無法使用麥克風，請使用 HTTPS 或本機 localhost 開啟。');
      setMode(repair?'reconnecting':'connecting');
      const sid=await ensureSession();
      const d=await api('voice',{session_id:sid});
      const r=new sdk.Room({adaptiveStream:true,dynacast:true,audioCaptureDefaults:{echoCancellation:true,noiseSuppression:false,autoGainControl:true}});
      room.current=r;
      const epoch=generation.current;
      const current=()=>epoch===generation.current && room.current===r && mounted.current;
      const agentReady=()=>{if(voiceTimer.current)clearTimeout(voiceTimer.current);voiceTimer.current=null;};
      r.on(sdk.RoomEvent.TrackSubscribed,track=>{if(!current()||track.kind!==sdk.Track.Kind.Audio)return;const element=track.attach();element.autoplay=true;element.muted=mutedRef.current;audio.current?.appendChild(element);element.play().catch(()=>{if(current())blocked(true);});remoteTracks.current.add(track.mediaStreamTrack.id);attachMeter(track.mediaStreamTrack);});
      r.on(sdk.RoomEvent.TrackUnsubscribed,track=>{track.detach().forEach(el=>el.remove());const id=track.mediaStreamTrack.id;remoteTracks.current.delete(id);remoteEnergy.current.delete(id);analysers.current.delete(id);sources.current.get(id)?.disconnect();sources.current.delete(id);});
      r.on(sdk.RoomEvent.AudioPlaybackStatusChanged,()=>{if(current())blocked(!r.canPlaybackAudio);});
      r.on(sdk.RoomEvent.TranscriptionReceived,(segments,participant)=>{if(!current()||!participant?.isLocal)return;for(const segment of segments)if(segment.text)upsert({id:'local-draft',role:'user',text:segment.text,partial:!segment.final});});
      r.on(sdk.RoomEvent.ActiveSpeakersChanged,participants=>{if(current())setSpeaking(participants.some(p=>!p.isLocal));});
      r.on(sdk.RoomEvent.ParticipantConnected,p=>{if(p.isAgent)agentReady();});
      r.on(sdk.RoomEvent.ParticipantDisconnected,p=>{if(!current()||!p.isAgent||!voiceWanted.current)return;setVoiceNotice('助理語音已離線，正在重新連線…');if(voiceTimer.current)clearTimeout(voiceTimer.current);voiceTimer.current=setTimeout(()=>{if(current()&&voiceWanted.current)restoreVoice.current();},1500);});
      r.on(sdk.RoomEvent.Reconnecting,()=>{if(current())setMode('reconnecting');});
      r.on(sdk.RoomEvent.Reconnected,()=>{if(current()){setMode(r.localParticipant.isMicrophoneEnabled?'listening':'idle');void resumePlayback().catch(()=>blocked(true));}});
      r.on(sdk.RoomEvent.Disconnected,()=>{if(!current())return;agentReady();room.current=null;setCallActive(false);setMode('idle');setSpeaking(false);setMicActive(false);meterCleanup.current();audio.current?.replaceChildren();setVoiceNotice('通話連線已結束，可按「恢復語音」重新連線。');});
      r.registerTextStreamHandler('morari.voice.events',async reader=>{
        const raw=await reader.readAll();if(!current())return;
        try {const e=JSON.parse(raw);if(e.session_id!==sid)return;
          if(e.type==='voice_error'){setError(notices[e.kind]||'這次語音未能辨識，請再說一次。');return;}
          if(e.type==='final_transcript'&&e.request_id&&e.text){health.current.begin(e.request_id);setMessages(old=>old.filter(m=>m.id!=='local-draft'));upsert({id:`user-${e.request_id}`,role:'user',text:e.text});void resumePlayback().catch(()=>blocked(true));void runTurn(e.request_id,sid);}
        } catch {setError('無法讀取語音字幕，請再試一次。');}
      });
      await r.connect(d.url,d.token);if(!current()){await r.disconnect();return;}
      await resumePlayback().catch(()=>blocked(true));
      await hello;
      if(!current()){await r.disconnect();return;}
      await r.localParticipant.setMicrophoneEnabled(wanted);
      voiceWanted.current=wanted;
      const track=r.localParticipant.getTrackPublication(sdk.Track.Source.Microphone)?.track?.mediaStreamTrack;
      startMeter();
      if(track)attachMeter(track);
      r.remoteParticipants.forEach(p=>p.audioTrackPublications.forEach(pub=>{if(pub.track)attachMeter(pub.track.mediaStreamTrack);}));
      setMode(wanted?'listening':'idle');setCanRepair(true);setCallActive(true);if(!repair){setCallStartedAt(Date.now());setElapsed(0);}setVoiceNotice(repair?'語音已重新連線，請再說一句話試試。':'');
      if(![...r.remoteParticipants.values()].some(p=>p.isAgent))voiceTimer.current=setTimeout(()=>{if(current())setError('助理仍在準備中；若持續沒有回應，請暫停後重新開啟麥克風。');},20000);
    } catch(e) {
      const r=room.current;room.current=null;await r?.disconnect();meterCleanup.current();audio.current?.replaceChildren();setMode('idle');setCallActive(false);setSpeaking(false);setVoiceNotice('');
      setError(e instanceof Error && e.name==='NotAllowedError'?'麥克風權限尚未開啟，請在瀏覽器允許麥克風後重試。':e instanceof Error?e.message:'語音連線失敗，請再試一次。');
    } finally {changing.current=false;}
  }
  restoreVoice.current=()=>{if(!changing.current&&health.current.canAttempt(Date.now()))void toggleMic(true);};
  async function endCall() {
    if(changing.current)return;
    changing.current=true;voiceWanted.current=false;health.current.reset();
    if(voiceTimer.current)clearTimeout(voiceTimer.current);
    const old=room.current;room.current=null;
    try {await old?.disconnect();} finally {
      meterCleanup.current();audio.current?.replaceChildren();remoteTracks.current.clear();remoteEnergy.current.clear();
      setCallActive(false);setCallStartedAt(null);setMode('idle');setSpeaking(false);setMicActive(false);setCanRepair(false);blocked(false);setError('');setVoiceNotice('');setFarewell(true);helloPlayed.current=false;
      try { await playCue('goodbye'); } finally {changing.current=false;}
    }
  }
  async function newConversation() {
    if(changing.current||sending||busy)return;
    changing.current=true;generation.current++;if(voiceTimer.current)clearTimeout(voiceTimer.current);
    controllers.current.forEach(c=>c.abort());activeTurns.current.clear();following.current.clear();
    const old=room.current;room.current=null;await old?.disconnect();meterCleanup.current();audio.current?.replaceChildren();
    session.current=null;cueStop.current();setFarewell(false);helloPlayed.current=false;voiceWanted.current=false;health.current.reset();remoteTracks.current.clear();remoteEnergy.current.clear();setCallActive(false);setCallStartedAt(null);setElapsed(0);setCanRepair(false);setVoiceNotice('');setMessages([]);setError('');setMode('idle');setBusy(false);setSpeaking(false);setMicActive(false);blocked(false);changing.current=false;
  }
  function toggleSound(){const next=!muted;setMuted(next);mutedRef.current=next;if(cueAudio.current)cueAudio.current.muted=next;audio.current?.querySelectorAll('audio').forEach(el=>{el.muted=next;});}
  async function unlockAudio(){await resumePlayback();}
  const connecting=mode==='connecting'||mode==='reconnecting';
  const status=cueSpeaking?(farewell?'承蒙你，正來尞':'你好，食飽吂？'):mode==='connecting'?'正在撥給哈妮…':mode==='reconnecting'?'正在恢復通話…':callActive?'':farewell?'承蒙你，正來尞':'你好，食飽吂？';
  const duration=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
  return <div className="app">
    <header className="topbar"><a className="wordmark" href="/" aria-label="國立聯合大學客家研究學院客家AI生態系首頁">國立聯合大學客家研究學院客家AI生態系</a><span className="header-note">一通電話，用客語聊聊。</span><span className="language"><span/>客語</span></header>
    <main className={`call-layout ${showSubtitles?'with-subtitles':''}`}>
      <section className="call-area" aria-label="與哈妮通話">
        <div className="call-intro"><h1>想講客話，打分哈妮</h1></div>
        <div className={`contact-card ${callActive?'in-call':''}`}>
          <div className="contact-heading"><div><h2>哈妮</h2><span>Hani</span></div><span className={`availability ${callActive?'live':''}`}>{callActive?<><span/>{duration}</>:<>客語夥伴</>}</span></div>
          <div ref={orb} className={`orb-stage ${micActive||speaking||cueSpeaking?'is-active':''} ${connecting?'is-connecting':''}`}>
            <span className="orbit"/><span className="orbit"/><span className="ripple"/><span className="ripple delay"/>
            <div className="hani-avatar" aria-hidden="true"/>
          </div>
          <div className="contact-status" role="status">{status}</div><div ref={bars} className="wave-bars" aria-hidden="true">{Array.from({length:17},(_,i)=><i key={i}/>)}</div>
          {!callActive&&<p className="card-caption">說說今天，或只是打聲招呼。</p>}
        </div>
        {!callActive?<button className="call-button" disabled={connecting||cueSpeaking} onClick={()=>toggleMic()}><Icon name="phone"/>{connecting?'正在連線…':cueSpeaking&&farewell?'道別中…':'開始通話'}</button>:<div className="call-controls"><button className={`control-button ${mode==='idle'?'selected':''}`} onClick={()=>toggleMic()} disabled={connecting} aria-pressed={mode==='idle'} aria-label={mode==='idle'?'開啟麥克風':'暫停麥克風'}><Icon name={mode==='idle'?'mute':'mic'}/><span>{mode==='idle'?'開啟麥克風':'麥克風'}</span></button><button className="hangup-button" onClick={endCall} disabled={connecting} aria-label="結束通話"><Icon name="hangup"/></button><button className={`control-button ${muted?'selected':''}`} onClick={toggleSound} aria-pressed={muted} aria-label={muted?'開啟哈妮的聲音':'靜音哈妮的聲音'}><Icon name={muted?'quiet':'sound'}/><span>{muted?'開啟聲音':'聲音'}</span></button></div>}
        <button className={`subtitle-toggle ${showSubtitles?'enabled':''}`} role="switch" aria-checked={showSubtitles} aria-controls="conversation-subtitles" onClick={()=>setShowSubtitles(v=>!v)}><Icon name="chat"/><span>{showSubtitles?'關閉對話字幕':'開啟對話字幕'}</span><span className="switch-track"><span/></span></button>
        {canRepair&&<button className="repair-voice" disabled={connecting} onClick={()=>toggleMic(true)}>恢復語音</button>}
        <div className="call-notices">{voiceNotice&&<p className="voice-notice" role="status">{voiceNotice}</p>}{error&&<p className="error" role="alert">{error}</p>}{audioBlocked&&<button className="audio-unlock" onClick={()=>unlockAudio().catch(()=>setError('請檢查瀏覽器的聲音播放權限。'))}>點一下，開啟哈妮的聲音</button>}</div>
      </section>
      <section id="conversation-subtitles" className="chat-panel" hidden={!showSubtitles} aria-label="對話字幕">
        <header className="chat-header"><div className="chat-title">對話字幕<span>與哈妮</span></div><div className="chat-tools"><button className="icon-btn" disabled={sending||busy||connecting} onClick={newConversation} aria-label="開始新對話"><Icon name="plus"/></button><button className="icon-btn" onClick={()=>setShowSubtitles(false)} aria-label="關閉對話字幕"><Icon name="close"/></button></div></header>
        <div className="chat-scroll" ref={scroll} role="log" aria-label="對話紀錄" aria-live={showSubtitles?'polite':'off'} aria-relevant="additions text">
          {messages.length===0?<div className="empty-subtitles"><Icon name="chat"/><h3>你好，食飽吂？</h3><p>開始通話後，字幕會即時顯示在這裡。</p><div className="suggestions">{prompts.map(p=><button key={p} disabled={sending} onClick={()=>send(p)}>{p}</button>)}</div></div>:messages.map(m=><article key={m.id} className={`message ${m.role} ${m.partial?'partial':''}`}><div className="message-label">{m.role==='user'?'你':'哈妮'}{m.partial&&<span>・{m.role==='user'?'辨識中':'回覆中'}</span>}</div><div className="bubble">{m.text}</div></article>)}
          {busy&&<div className="thinking" role="status" aria-label="哈妮正在回覆"><i/><i/><i/></div>}
        </div><div className="chat-bottom"><form className="inputbox" onSubmit={e=>{e.preventDefault();void send(text);}}><label htmlFor="message" className="sr-only">輸入文字訊息</label><input id="message" value={text} onChange={e=>setText(e.target.value)} maxLength={7900} placeholder="也可以打字給哈妮…" disabled={sending}/><button type="submit" aria-label="傳送訊息" disabled={!text.trim()||sending}><Icon name="send"/></button></form><p className="input-meta">語音與文字，共用同一段對話。</p></div>
      </section>
    </main><footer className="page-footer"><span>隨時，來講兩句。</span><small>語音及訊息由 Morari 處理 · AI 回覆可能有誤</small></footer><div ref={audio} className="replay-audio"/><audio ref={cueAudio} preload="auto" src="/audio/hani-hello.wav" className="replay-audio"/>
  </div>;
}
