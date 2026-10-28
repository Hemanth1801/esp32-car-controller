const assert=require('node:assert/strict');
const {BrakeRumble}=require('../web/mapping.js');
async function main(){
  const calls=[],reports=[];
  const pad={connected:true,index:0,id:'wheel',vibrationActuator:{playEffect:(...args)=>{calls.push(args);return Promise.resolve('complete')},reset:()=>Promise.resolve('complete')}};
  const r=new BrakeRumble(m=>reports.push(m));
  r.update(pad,0);r.update(pad,.8);r.update(pad,.9);
  assert.equal(calls.length,1,'Holding brake must not repeat the burst');
  assert.equal(calls[0][0],'dual-rumble');assert.equal(calls[0][1].duration,200);
  await Promise.resolve();r.update(pad,.08);r.update(pad,.8);assert.equal(calls.length,1,'Noise above release threshold must not retrigger');
  r.update(pad,0);r.update(pad,.8);assert.equal(calls.length,2,'Release then press must retrigger');
  r.cancel();r.update(pad,.8,false);assert.equal(calls.length,2,'Disabled feedback must not vibrate');
  const unsupported={connected:true,index:1,id:'no rumble'};
  r.update(unsupported,.8);assert.match(reports.at(-1),/does not expose/);
  const rejecting={connected:true,index:2,id:'rejects',vibrationActuator:{playEffect:()=>Promise.reject(Error('unsupported'))}};
  r.update(rejecting,.8);await Promise.resolve();await Promise.resolve();assert.match(reports.at(-1),/driving inputs still work/);
  let pulsed=false;const legacy={connected:true,index:3,id:'legacy',hapticActuators:[{pulse:(intensity,duration)=>{pulsed=duration===200;return Promise.resolve(true)}}]};
  r.update(legacy,.8);assert.equal(pulsed,true);
  console.log('Brake rumble checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});
