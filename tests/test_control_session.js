'use strict';
const assert=require('node:assert/strict');
const {ControlSession,commandTimeoutText}=require('../web/control-session.js');
assert.match(commandTimeoutText({command_timeout_enabled:false,command_timeout_ms:0}),/timeout OFF/);
assert.match(commandTimeoutText({command_timeout_enabled:true,command_timeout_ms:400}),/400 ms/);
assert.match(commandTimeoutText({}),/400 ms/,'Legacy firmware still reports the enabled timeout');
const response=state=>({ok:true,json:async()=>state});
const neutral={throttle:0,steering:0};
(async()=>{
  const calls=[];let armed=false,stops=0,inputs=neutral;
  const fetcher=async(path,options)=>{
    const data=options.body?JSON.parse(options.body):null;calls.push({path,data});
    if(path==='/api/arm')armed=true;
    if(path==='/api/stop')armed=false;
    return response({connected:true,output_enabled:true,armed,session:armed?'session-1':'',throttle:0,steering:0});
  };
  const client=new ControlSession({autoStart:false,fetcher,getInput:()=>inputs,onStop:()=>stops++});
  assert.equal(await client.arm(),true);inputs={throttle:.3,steering:-.2};
  await client.poll();assert.equal(calls.at(-1).data.throttle,.3);assert.equal(calls.at(-1).data.seq,1);assert.equal(calls.at(-1).data.session,'session-1');
  await client.poll();assert.equal(calls.at(-1).data.seq,2);
  await client.stop();assert.equal(client.armed,false);assert.equal(client.session,'');assert.ok(stops);
  assert.equal(await client.arm(),false,'Non-neutral input must not arm');

  let finishArm;const late=new ControlSession({autoStart:false,fetcher:(path)=>path==='/api/arm'?new Promise(resolve=>finishArm=resolve):Promise.resolve(response({armed:false})),getInput:()=>neutral});
  const arming=late.arm();await late.stop();finishArm(response({armed:true,session:'late'}));await arming;
  assert.equal(late.armed,false,'Late arm response cannot re-arm after stop');

  const failureStates=[];
  const disarmReasons=[];
  let fail=false;const failed=new ControlSession({autoStart:false,getInput:()=>{if(fail)throw Error('Input sample expired');return neutral},fetcher,onState:state=>failureStates.push(state),onStop:(reason,wasActive)=>{if(wasActive)disarmReasons.push(reason)}});
  await failed.arm();fail=true;await failed.poll();assert.equal(failed.armed,false,'Stale input samples disarm');
  const expired=failureStates.find(state=>state.message==='Input sample expired');
  assert.equal(expired.connected,true,'An expired input must not claim Wi-Fi is offline');
  assert.equal(expired.output_enabled,true,'Input failure preserves the known hardware mode');
  assert.deepEqual(disarmReasons,['Input sample expired'],'The owning client reports the exact reason for disarming');
  assert.equal(failed.lastStatus,-Infinity,'Input failure triggers a fresh passive connection check');
  const before=calls.filter(c=>c.path==='/api/control').length;
  await failed.poll();assert.equal(calls.filter(c=>c.path==='/api/control').length,before,'No replay after failure');

  const noLink=new ControlSession({autoStart:false,getInput:()=>neutral,fetcher:async()=>{throw Error('offline')}});
  assert.equal(await noLink.arm(),false);assert.equal(noLink.armed,false);
  let idleNow=0,idleChecks=0;
  const idleOffline=new ControlSession({autoStart:false,now:()=>idleNow,fetcher:async()=>{idleChecks++;throw Error('offline')}});
  await idleOffline.poll();await idleOffline.poll();
  assert.equal(idleChecks,1,'Idle failure must not cause a rapid retry loop');
  idleNow=999;await idleOffline.poll();assert.equal(idleChecks,1);
  idleNow=1000;await idleOffline.poll();assert.equal(idleChecks,2,'Idle keepalive retries after one second');

  for(const status of [409,503]){
    const states=[],paths=[];let reject=false;
    const checked=new ControlSession({autoStart:false,getInput:()=>neutral,onState:state=>states.push(state),fetcher:async(path)=>{
      paths.push(path);
      if(reject&&path==='/api/control')return {ok:false,status,json:async()=>({error:'Command failed'})};
      return response({connected:true,armed:path!=='/api/stop',session:'checked'});
    }});
    await checked.arm();reject=true;await checked.poll();
    const failure=states.find(state=>state.message==='Command failed');
    assert.equal(failure.connected,status===409,'A rejection differs from an unreachable ESP');
    assert.equal(checked.armed,false,'Every failed drive command still disarms');
    assert.equal(paths.filter(path=>path==='/api/control').length,1,'Failed commands are never retried');
    assert.ok(paths.includes('/api/stop'),'A failed owner command still sends Stop');
  }

  // A passive tab's focus/navigation/status failures must never stop the owner.
  let ownerArmed=false,observerOffline=false;const sharedCalls=[];
  const sharedFetch=async(path,options)=>{
    sharedCalls.push(path);
    if(path==='/api/arm')ownerArmed=true;
    if(path==='/api/stop')ownerArmed=false;
    return response({armed:ownerArmed,session:ownerArmed?'owner-session':''});
  };
  const owner=new ControlSession({autoStart:false,getInput:()=>neutral,fetcher:sharedFetch});
  const observer=new ControlSession({autoStart:false,getInput:()=>neutral,fetcher:(...args)=>{if(observerOffline)throw Error('Status unavailable');return sharedFetch(...args)}});
  await owner.arm();await owner.poll();
  const remoteStops=()=>sharedCalls.filter(path=>path==='/api/stop').length;
  await observer.stop();assert.equal(remoteStops(),0,'Passive blur/navigation is local only');
  await observer.poll();assert.equal(observer.armed,false);assert.equal(ownerArmed,true);
  observerOffline=true;observer.lastStatus=-Infinity;await observer.poll();
  assert.equal(remoteStops(),0,'Passive status failure cannot send a global stop');
  assert.equal(ownerArmed,true);assert.equal(owner.armed,true);
  const beacons=[];
  Object.defineProperty(globalThis,'navigator',{value:{sendBeacon:(...args)=>beacons.push(args)},configurable:true});
  observer.beaconStop();assert.equal(beacons.length,0,'Closing passive tab cannot stop owner');
  owner.beaconStop();assert.equal(beacons.length,1,'Closing owning page still sends Stop');
  observerOffline=false;await observer.stop({force:true});assert.equal(remoteStops(),1,'Emergency Stop works even from an unarmed page');
  console.log('Control session passed: ownership, passive tabs, emergency stop, sequences, neutral arm, stop/arm race, expired samples, failures and no replay.');
})().catch(error=>{console.error(error);process.exitCode=1});
