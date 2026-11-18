import test from 'node:test';
import assert from 'node:assert/strict';
import { morari } from '../lib/morari.ts';
import { events } from '../lib/sse.mjs';

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
  const denied=await morari(new Request('https://app.test/api/morari/admin?session_id=test'),{});
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
    const response=await morari(new Request('https://app.test/api/morari/voice',{method:'POST',body:JSON.stringify({session_id:'sid',voice_language:'zh'})}),{MORARI_USERNAME:'unit-test',MORARI_PASSWORD:'unit-secret'});
    assert.equal(response.status,200);assert.equal(logins,2);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body),{session_id:'sid',voice_language:'hak'});
    const body=await response.text();assert.ok(!body.includes('account-token'));assert.ok(!body.includes('unit-secret'));
    assert.equal(response.headers.get('Cache-Control'),'no-store, no-transform');
  }finally{globalThis.fetch=original;}
});
