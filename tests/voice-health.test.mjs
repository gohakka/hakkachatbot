import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceHealth } from '../lib/voice-health.mjs';
const available={listening:true,muted:false,blocked:false,visible:true};
function silentTurn(h,id='next',now=0){h.begin(id);h.text(id,now+100);h.finish(id,'completed',now+200);}
test('an intentional interruption does not trigger recovery; a silent subsequent answer does',()=>{
  const h=new VoiceHealth();h.begin('interrupted');h.text('interrupted',100);h.finish('interrupted','interrupted',200);
  assert.equal(h.shouldRecover(20000,available),false);
  silentTurn(h);assert.equal(h.shouldRecover(10199,available),false);assert.equal(h.shouldRecover(10200,available),true);
});
test('actual remote audio cancels recovery, including during ongoing responses',()=>{
  const h=new VoiceHealth();silentTurn(h);h.heard(300);assert.equal(h.shouldRecover(30000,available),false);
});
test('text requests and old turns cannot trigger or finish the latest voice watchdog',()=>{
  const h=new VoiceHealth();h.text('typed',0);h.finish('typed','completed',1);assert.equal(h.shouldRecover(20000,available),false);
  h.begin('new');h.text('old',1);h.finish('old','completed',2);assert.equal(h.shouldRecover(20000,available),false);
});
test('never reconnect just because an answer is still thinking or streaming',()=>{
  const h=new VoiceHealth();h.begin('long');h.text('long',100);assert.equal(h.shouldRecover(120000,available),false);
});
test('pause, mute, blocked playback and background tabs suppress resets',()=>{
  for(const override of [{listening:false},{muted:true},{blocked:true},{visible:false}]){
    const h=new VoiceHealth();silentTurn(h);assert.equal(h.shouldRecover(20000,{...available,...override}),false);
  }
});
test('automatic recovery is bounded and cooled down; audible recovery resets the budget',()=>{
  const h=new VoiceHealth();silentTurn(h);h.attempted(10200);
  silentTurn(h,'two',11000);assert.equal(h.shouldRecover(30000,available),false);assert.equal(h.shouldRecover(55200,available),true);
  h.attempted(55200);silentTurn(h,'three',60000);assert.equal(h.shouldRecover(120000,available),false);
  h.heard(120000);assert.equal(h.canAttempt(120000),true);
  h.reset();assert.equal(h.shouldRecover(200000,available),false);
});
