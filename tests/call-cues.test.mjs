import test from 'node:test';
import assert from 'node:assert/strict';
import { playCallCue } from '../lib/call-cues.mjs';
class FakeAudio extends EventTarget {
  src=''; paused=true; rejected=false;
  play(){if(this.rejected)return Promise.reject(new Error('NotAllowedError'));this.paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}
  pause(){this.paused=true;}
}
test('greeting completes after playback ends and cleans up the audio',async()=>{
  const audio=new FakeAudio();let playing=0;const cue=playCallCue(audio,'/audio/hani-hello.wav',()=>playing++);
  assert.equal(audio.src,'/audio/hani-hello.wav');assert.equal(playing,1);assert.equal(audio.paused,false);
  audio.dispatchEvent(new Event('ended'));assert.equal(await cue.done,true);assert.equal(audio.paused,true);
});
test('blocked autoplay releases call setup rather than hanging',async()=>{
  const audio=new FakeAudio();audio.rejected=true;const cue=playCallCue(audio,'hello');assert.equal(await cue.done,false);
});
test('hangup/unmount can stop a greeting; late events cannot affect another cue',async()=>{
  const audio=new FakeAudio();const hello=playCallCue(audio,'hello');hello.stop();assert.equal(await hello.done,false);
  const bye=playCallCue(audio,'goodbye');hello.stop();assert.equal(audio.paused,false);audio.dispatchEvent(new Event('ended'));assert.equal(await bye.done,true);
});
test('unresponsive audio times out and never leaves the microphone locked',async()=>{
  const audio=new FakeAudio();const cue=playCallCue(audio,'missing',()=>{},5);assert.equal(await cue.done,false);assert.equal(audio.paused,true);
});
