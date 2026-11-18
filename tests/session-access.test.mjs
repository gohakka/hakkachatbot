import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformOwner, guestSession, sessionCookie } from '../lib/session-access.ts';
import { morari } from '../lib/morari.ts';
const env={MORARI_USERNAME:'guest-isolation-test',MORARI_PASSWORD:'unit-only-signing-secret',MORARI_OWNER_EMAIL:'owner@example.test'};
const request=(path,headers={},init={})=>new Request(`https://app.test/api/morari/${path}`,{...init,headers});
test('only a matching Sites identity can access the platform account history',()=>{
  assert.equal(isPlatformOwner(request('viewer'),env),false);
  assert.equal(isPlatformOwner(request('viewer',{'oai-authenticated-user-email':'owner@example.test'}),env),false);
  assert.equal(isPlatformOwner(request('viewer',{'oai-authenticated-user-id':'someone','oai-authenticated-user-email':'visitor@example.test'}),env),false);
  assert.equal(isPlatformOwner(request('viewer',{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'OWNER@example.test'}),env),true);
});
test('a guest cookie cannot be changed to another conversation or reused with another secret',async()=>{
  const cookie=await sessionCookie('mine',env);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
  assert.equal(await guestSession(request('sessions',{Cookie:cookie}),env),'mine');
  assert.equal(await guestSession(request('sessions',{Cookie:cookie.replace('mine.','theirs.')}),env),null);
  assert.equal(await guestSession(request('sessions',{Cookie:cookie}),{MORARI_PASSWORD:'another-secret'}),null);
  assert.equal(await guestSession(request('sessions',{Cookie:'hani_conversation=mine.0.invalid'}),env),null);
});
test('anonymous visitors never receive the shared account session list or another session data',async()=>{
  const list=await morari(request('sessions'),env);assert.deepEqual(await list.json(),[]);
  for(const path of ['history?session_id=theirs','pending?session_id=theirs','follow?session_id=theirs&request_id=turn'])assert.equal((await morari(request(path),env)).status,403);
  assert.equal((await morari(request('session',{}, {method:'POST',body:JSON.stringify({session_id:'theirs'})}),env)).status,403);
  const cookie=await sessionCookie('mine',env);
  const ownList=await morari(request('sessions',{Cookie:cookie}),env);assert.deepEqual(await ownList.json(),[{session_id:'mine',title:'這段對話'}]);
  assert.equal((await morari(request('history?session_id=theirs',{Cookie:cookie}),env)).status,403);
});
test('new guests get a fresh platform session, then reload the same signed session',async()=>{
  const original=globalThis.fetch;const bodies=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('/auth/login'))return Response.json({access_token:'unit-token'});
    bodies.push(options.body?JSON.parse(options.body):null);
    return Response.json(String(url).includes('/messages')?{items:[],has_more:false}:{session_id:'mine'});
  };
  try{
    const opened=await morari(request('session',{}, {method:'POST',body:JSON.stringify({force_new:false})}),env);
    const cookie=opened.headers.get('Set-Cookie');assert.ok(cookie);assert.deepEqual(bodies[0],{session_id:null,force_new:true});
    const resumed=await morari(request('session',{Cookie:cookie},{method:'POST',body:JSON.stringify({session_id:'mine',force_new:false})}),env);
    assert.equal(resumed.status,200);assert.deepEqual(bodies[1],{session_id:'mine',force_new:false});
    assert.equal((await morari(request('history?session_id=mine',{Cookie:cookie}),env)).status,200);
  }finally{globalThis.fetch=original;}
});
