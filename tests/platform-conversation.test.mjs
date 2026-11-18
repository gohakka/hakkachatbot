import test from 'node:test';
import assert from 'node:assert/strict';
import { openPlatformConversation, platformUserText, platformMessageText, waitForPlatformRequest } from '../lib/platform-conversation.mjs';

function fakePlatform(list) {
  const calls=[];
  const request=async(path,body)=>{calls.push([path,body]);return path==='sessions'?list:{session_id:body.session_id??'created'};};
  return {request,calls};
}
test('reloading an explicit platform conversation retains its ID and never forces a new one',async()=>{
  const f=fakePlatform([{session_id:'latest',title:'最近'},{session_id:'original',title:'原對話'}]);
  const result=await openPlatformConversation(f.request,'original');
  assert.equal(result.sessionId,'original');assert.deepEqual(f.calls[1],['session',{session_id:'original',force_new:false}]);
});
test('without URL selection use the first server conversation like the original page',async()=>{
  const f=fakePlatform([{session_id:'recent',title:'最近'}]);
  assert.equal((await openPlatformConversation(f.request)).sessionId,'recent');
  assert.deepEqual(f.calls[1][1],{session_id:'recent',force_new:false});
});
test('force_new is used only for the explicit new-conversation action',async()=>{
  const f=fakePlatform([{session_id:'old',title:'舊對話'}]);
  const result=await openPlatformConversation(f.request,'old',true);
  assert.equal(result.sessionId,'created');assert.deepEqual(f.calls[1][1],{session_id:null,force_new:true});assert.equal(result.sessions[0].session_id,'created');
});
test('an empty account lets the platform open its default conversation without forcing one',async()=>{
  const f=fakePlatform([]);await openPlatformConversation(f.request);assert.deepEqual(f.calls[1][1],{session_id:null,force_new:false});
});
test('send the original input and preserve raw platform wording, including errors for comparison',()=>{
  assert.equal(platformUserText(' 你做得教𠊎無？ '),'你做得教𠊎無？');
  assert.equal(platformMessageText([{type:'text',text:'做到，'},{type:'thinking',text:'hidden'},{type:'text',text:'當然做到！'}]),'做到，當然做到！');
  assert.equal(platformMessageText([{type:'text',text:'請用客語回答以下訊息：\n這是使用者原文'}]),'請用客語回答以下訊息：\n這是使用者原文');
});
test('a lost stream polls the same request until completed without submitting another turn',async()=>{
  let reads=0;const sleeps=[];
  const result=await waitForPlatformRequest(async()=>({status:++reads===3?'completed':'running'}),{sleep:async ms=>{sleeps.push(ms);}});
  assert.equal(result.status,'completed');assert.equal(reads,3);assert.deepEqual(sleeps,[1000,1000]);
});
test('aborted and unresolved requests stop polling; cancelled requests settle normally',async()=>{
  const c=new AbortController();c.abort();let reads=0;
  assert.equal(await waitForPlatformRequest(async()=>{reads++;return {status:'running'};},{signal:c.signal}),null);assert.equal(reads,0);
  assert.equal(await waitForPlatformRequest(async()=>({status:'running'}),{attempts:2,sleep:async()=>{}}),null);
  assert.equal((await waitForPlatformRequest(async()=>({status:'cancelled'}))).status,'cancelled');
});
