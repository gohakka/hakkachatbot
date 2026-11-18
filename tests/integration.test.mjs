import test from 'node:test';
import assert from 'node:assert/strict';
import { morari } from '../lib/morari.ts';
import { events } from '../lib/sse.mjs';
const ownerHeaders={'oai-authenticated-user-id':'owner-id','oai-authenticated-user-email':'owner@example.test'};
const ownerEnv={MORARI_OWNER_EMAIL:'owner@example.test'};

test('SSE handles UTF-8 split across chunks, CRLF frames and keepalives', async () => {
  const bytes = new TextEncoder().encode(': ping\r\n\r\nevent: event\r\ndata: {"text":"客語"}\r\n\r\nevent: final\ndata: {"status":"completed"}\n\n');
  let offset = 0;
  const response = new Response(new ReadableStream({ pull(c) { if(offset>=bytes.length){c.close();return;} c.enqueue(bytes.slice(offset,offset+3));offset+=3; } }));
  const frames = [];
  for await(const frame of events(response))frames.push(frame);
  assert.deepEqual(frames,[{name:'event',data:{text:'客語'}},{name:'final',data:{status:'completed'}}]);
});
test('proxy refuses other origins, malformed IDs and arbitrary upstream paths', async () => {
  const cross = await morari(new Request('https://app.test/api/morari/session',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),{});
  assert.equal(cross.status,403);
  const malformed=await morari(new Request('https://app.test/api/morari/history?session_id=../../auth'),{});
  assert.equal(malformed.status,400);
  const denied=await morari(new Request('https://app.test/api/morari/admin?session_id=test',{headers:ownerHeaders}),ownerEnv);
  assert.equal(denied.status,404);
});
test('voice always requests Hakka; account tokens stay on server; expired login retries once', async () => {
  const original=globalThis.fetch;const calls=[];let logins=0;
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/auth/login'))return Response.json({access_token:`account-token-${++logins}`});
    if(logins===1)return Response.json({detail:'expired'},{status:401});
    return Response.json({token:'room-only-token',url:'wss://voice.test',session_id:'sid'});
  };
  try{
    const response=await morari(new Request('https://app.test/api/morari/voice',{method:'POST',headers:ownerHeaders,body:JSON.stringify({session_id:'sid',voice_language:'zh'})}),{...ownerEnv,MORARI_USERNAME:'unit-test',MORARI_PASSWORD:'unit-secret'});
    assert.equal(response.status,200);assert.equal(logins,2);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body),{session_id:'sid',voice_language:'hak'});
    const body=await response.text();assert.ok(!body.includes('account-token'));assert.ok(!body.includes('unit-secret'));
    assert.equal(response.headers.get('Cache-Control'),'no-store, no-transform');
  }finally{globalThis.fetch=original;}
});

test('session list, pending turns and request status use the same original-page endpoints', async()=>{
  const original=globalThis.fetch;const paths=[];
  globalThis.fetch=async(url)=>{paths.push(new URL(url).pathname);return Response.json(String(url).endsWith('/auth/login')?{access_token:'test-platform-token'}:{ok:true});};
  try{
    const env={...ownerEnv,MORARI_USERNAME:'platform-parity-test',MORARI_PASSWORD:'test-secret'};
    for(const path of ['sessions','pending?session_id=original','request?session_id=original&request_id=turn']){
      const response=await morari(new Request(`https://app.test/api/morari/${path}`,{headers:ownerHeaders}),env);assert.equal(response.status,200);
    }
    assert.deepEqual(paths.filter(p=>!p.endsWith('/auth/login')),['/api/v1/assistant/sessions','/api/v1/assistant/sessions/original/pending','/api/v1/assistant/sessions/original/requests/turn']);
  }finally{globalThis.fetch=original;}
});
