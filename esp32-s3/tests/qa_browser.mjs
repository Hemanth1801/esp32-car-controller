import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base='http://127.0.0.1:8866';
const pages=await(await fetch('http://127.0.0.1:9337/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let next=0;const pending=new Map(),errors=[];
ws.onclose=()=>{for(const task of pending.values())task.reject(Error('Browser closed'));pending.clear()};
ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
  if(message.id&&pending.has(message.id)){
    const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
    message.error?reject(Error(message.error.message)):resolve(message.result);
  }
};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(50)}const details=await evaluate("({status:document.getElementById('status')?.textContent,mode:document.getElementById('mode')?.textContent,error:document.getElementById('inputError')?.textContent,input:document.getElementById('inputValues')?.textContent,active:typeof active==='undefined'?null:active,hidden:document.hidden})");throw Error('Timed out: '+expression+' '+JSON.stringify(details))}
async function update(expression){await evaluate(expression);await wait(110)}
async function navigate(path,marker){await send('Page.navigate',{url:base+path});await until(`location.pathname===${JSON.stringify(path)}&&document.readyState==='complete'&&!!document.getElementById(${JSON.stringify(marker)})`);await wait(200)}
async function arm(){await until('!controlClient.busy&&!controlClient.stopping');await evaluate("document.getElementById('arm').click()");await until('armed')}
try{
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.rumbleCalls=[];window.apiCalls=[];
    window.testPad={index:0,id:'QA steering wheel',connected:true,axes:[0],buttons:Array.from({length:5},()=>({value:0,pressed:false})),vibrationActuator:{playEffect:(kind,options)=>{window.rumbleCalls.push({kind,...options});return Promise.resolve('complete')},reset:()=>Promise.resolve('complete')}};
    Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPad?[window.testPad]:[],configurable:true});
    const originalFetch=window.fetch;
    window.fetch=(path,options)=>{window.apiCalls.push({path:String(path),body:options?.body?JSON.parse(options.body):null,time:Date.now()});return originalFetch(path,options)};
  `});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await navigate('/','carDiagram');
  // Default wheel behavior: auto-arm at neutral, then Button 0 latches disarmed.
  await update("RCMapping.saveSettings({...RCMapping.defaults,accelInput:'button:4',brakeInput:'button:1'});window.dispatchEvent(new StorageEvent('storage',{key:RCMapping.settingsKey}));pauseAutomatic(false)");
  await until('armed');
  await update('window.testPad.buttons[0].value=1');await until('!armed');
  assert.equal(await evaluate('autoArm.paused'),true);
  await update('window.testPad.buttons[0].value=0');await wait(700);
  assert.equal(await evaluate('armed'),false,'Button pause must defeat automatic arming');
  await navigate('/','carDiagram');await wait(700);
  assert.equal(await evaluate('autoArm.paused'),true,'Button pause persists across reload');
  assert.equal(await evaluate('armed'),false);
  await until('!controlClient.busy&&!controlClient.stopping');
  await update('window.testPad.buttons[0].value=1');await until('armed');
  await evaluate("document.getElementById('stop').click()");await until('!controlClient.stopping');
  await update('window.testPad.buttons[0].value=0');
  await evaluate('window.apiCalls=[]');
  // Axis selection must work even after keyboard mode and unusable old calibration.
  await update("window.testPad.axes=[0,0];mapping={...RCMapping.defaults,inputSource:'keyboard',steerCenter:.8,steerLeft:.8,steerRight:.8,accelFull:.72};save();settingsUI();padSignature=''");
  await update("document.getElementById('steerInput').value='axis:1';document.getElementById('steerInput').onchange();window.testPad.axes[1]=.6");
  assert.equal(await evaluate('mapping.inputSource'),'wheel');
  assert.equal(await evaluate('mapping.steerCenter'),0);
  assert.equal(await evaluate('mapping.accelFull'),.72,'Pedal calibration preserved');
  assert.match(await evaluate("document.getElementById('steerLive').textContent"),/axis:1 raw: 0.600/);
  assert.equal(await evaluate("document.getElementById('frontLeft').getAttribute('transform')"),'rotate(18 70 120)');
  await update("mapping.steerCenter=.6;mapping.steerLeft=.6;mapping.steerRight=.6;save();document.getElementById('resetSteering').click()");
  assert.equal(await evaluate('mapping.steerCenter'),0);
  assert.equal(await evaluate('mapping.accelFull'),.72);
  await update("window.testPad.axes=[0];padSignature=''");
  await update("RCMapping.saveSettings({...RCMapping.defaults,accelInput:'button:4',brakeInput:'button:1',reverseInput:'button:2',stopInput:'button:3'});window.dispatchEvent(new StorageEvent('storage',{key:RCMapping.settingsKey}))");
  await update('window.testPad.axes[0]=.6;window.testPad.buttons[4].value=.8');
  assert.equal(await evaluate("document.getElementById('frontLeft').getAttribute('transform')"),'rotate(18 70 120)');
  assert.equal(await evaluate("document.getElementById('motionState').textContent"),'Forward');
  assert.equal(await evaluate("window.apiCalls.filter(c=>c.path==='/api/control').length"),0,'Disarmed preview must not drive');
  await evaluate("document.getElementById('arm').click()");await wait(100);
  assert.equal(await evaluate('armed'),false,'Non-neutral inputs prevent arming');
  await update('window.testPad.buttons[0].value=1');
  assert.equal(await evaluate('armed'),false,'Button 0 cannot arm with non-neutral input');
  const deniedArmCount=await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length");
  await update('window.testPad.axes[0]=0;window.testPad.buttons[4].value=0');
  assert.equal(await evaluate('armed'),false,'Neutralizing while holding Button 0 must not auto-arm');
  assert.equal(await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length"),deniedArmCount);
  await update('window.testPad.buttons[0].value=0');await until('!controlClient.busy&&!controlClient.stopping');
  await update('window.testPad.buttons[0].value=1');await until('armed');
  const successfulArmCount=await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length");
  await wait(250);assert.equal(await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length"),successfulArmCount,'Holding cannot repeat Arm');
  await evaluate("document.getElementById('stop').click()");await until('!controlClient.stopping');
  await wait(150);assert.equal(await evaluate('armed'),false,'Held Button 0 cannot re-arm after Stop');
  await update('window.testPad.buttons[0].value=0');
  await update('window.testPad.buttons[1].value=1');
  assert.equal(await evaluate("document.getElementById('motionState').textContent"),'Braking');
  assert.equal(await evaluate('window.rumbleCalls.length'),1);await wait(220);assert.equal(await evaluate('window.rumbleCalls.length'),1);
  await update('window.testPad.axes[0]=0;window.testPad.buttons.forEach(b=>b.value=0)');await arm();
  await update('window.testPad.axes[0]=.5;window.testPad.buttons[4].value=.8');
  await until("window.apiCalls.filter(c=>c.path==='/api/control'&&c.body.throttle>.2).length>=3");
  const commands=await evaluate("window.apiCalls.filter(c=>c.path==='/api/control')");
  assert.ok(commands.some(c=>Math.abs(c.body.throttle-.8)<.0001));
  assert.ok(commands.every((c,i)=>i===0||c.body.session!==commands[i-1].body.session||c.body.seq>commands[i-1].body.seq));
  assert.ok(commands.some((c,i)=>i>0&&c.time-commands[i-1].time<100),'Control interval must approach 50 ms');
  assert.match(await evaluate("document.getElementById('serverValues').textContent"),/Motor output 0% \/ 0%/,'Dry run output stays zero');
  const stopCount=await evaluate("window.apiCalls.filter(c=>c.path==='/api/stop').length");
  await evaluate("window.passiveClient=new RCControls.ControlSession({autoStart:false,fetcher:async()=>{throw Error('Observer status unavailable')}});passiveClient.stop();passiveClient.poll();passiveClient.beaconStop()");
  for(let i=0;i<20;i++){await wait(250);assert.equal(await evaluate('controlClient.armed'),true,'Wheel must stay armed during a sustained command stream and passive-page failure')}
  assert.equal(await evaluate("window.apiCalls.filter(c=>c.path==='/api/stop').length"),stopCount,'Passive page cannot interrupt owner');
  // A delayed preview must not expire valid held input. Read the gamepad on
  // each command even while requestAnimationFrame is deliberately suspended.
  await evaluate('window.savedRAF=window.requestAnimationFrame;window.requestAnimationFrame=()=>0');
  await wait(200);const beforeHeld=await evaluate('window.testPad.axes[0]=-.75;window.testPad.buttons[4].value=.4;window.apiCalls.length');
  await wait(1400);
  assert.equal(await evaluate('controlClient.armed'),true,'Held steering remains armed without preview frames');
  const freshHeld=await evaluate(`window.apiCalls.slice(${beforeHeld}).filter(c=>c.path==='/api/control')`);
  assert.ok(freshHeld.length>=10,'Control streaming continues while preview is suspended');
  assert.ok(freshHeld.every(c=>c.body.steering===-.75&&Math.abs(c.body.throttle-.4)<.0001),'Every command uses fresh device input');
  await evaluate('window.testPad.buttons[0].value=1');await until('!controlClient.armed');
  assert.equal(await evaluate('autoArm.paused'),true,'Button 0 still disarms with a delayed preview');
  assert.match(await evaluate("document.getElementById('lastStop').textContent"),/Button 0/);
  await until('!controlClient.stopping');
  await evaluate('window.requestAnimationFrame=window.savedRAF;window.testPad.axes[0]=0;window.testPad.buttons.forEach(b=>b.value=0);requestAnimationFrame(tick)');
  await wait(150);await arm();
  await update("document.getElementById('limit').value='25';document.getElementById('limit').oninput();window.testPad.axes[0]=0;window.testPad.buttons.forEach(b=>b.value=0)");
  await arm();
  await update('window.testPad.axes[0]=.5;window.testPad.buttons[4].value=.8');
  await until("window.apiCalls.some(c=>c.path==='/api/control'&&Math.abs(c.body.throttle-.2)<.0001&&c.body.steering===.5)");
  await update('window.testPad.buttons[2].value=1');assert.equal(await evaluate('armed'),false,'Reverse selection disarms');
  assert.equal(await evaluate("document.getElementById('direction').textContent"),'Reverse selected');
  await update('window.testPad.axes[0]=0;window.testPad.buttons.forEach(b=>b.value=0)');await arm();
  await update('window.testPad.connected=false');assert.equal(await evaluate('armed'),false,'Controller disconnect disarms');
  await update("document.getElementById('source').value='keyboard';document.getElementById('source').onchange()");await arm();
  await update("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'}))");
  assert.equal(await evaluate("document.getElementById('motionState').textContent"),'Forward');
  await update("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))");assert.equal(await evaluate('armed'),false);
  await arm();await update("window.dispatchEvent(new Event('blur'))");assert.equal(await evaluate('armed'),false,'Focus loss disarms');
  await update("window.dispatchEvent(new Event('focus'))");
  await arm();await update("document.getElementById('limit').value='20';document.getElementById('limit').oninput()");assert.equal(await evaluate('armed'),false,'Output limit change disarms');
  await update("document.getElementById('source').value='auto';document.getElementById('source').onchange()");await arm();
  await update('window.testPad.connected=true');assert.equal(await evaluate('armed'),false,'Automatic keyboard-to-wheel switch disarms');

  // Capture pedal values from fresh snapshots and retain calibration after reload.
  await update("window.testPad.connected=true;document.getElementById('source').value='wheel';document.getElementById('source').onchange()");
  await update("window.testPad.axes=[0,1];window.testPad.buttons.forEach(b=>b.value=0);mapping={...RCMapping.defaults,inputSource:'wheel'};save();settingsUI();padSignature=''");
  assert.match(await evaluate("document.getElementById('pedalStatus').textContent"),/not assigned/);
  await evaluate("document.querySelector('[data-setup-pedal=accel]').click()");
  assert.equal(await evaluate("document.getElementById('pedalSetup').open"),true);
  await until('!controlClient.stopping');
  await update('window.testPad.buttons[0].value=1');
  assert.equal(await evaluate('controlClient.armed'),false,'Button 0 cannot arm during pedal setup');
  assert.equal(await evaluate('autoArm.paused'),true,'Setup stays paused even if Button 0 is pressed');
  await update('window.testPad.buttons[0].value=0');
  await evaluate("document.getElementById('pedalReleased').click();window.testPad.axes[1]=-.8;document.getElementById('pedalPressed').click()");
  assert.equal(await evaluate("document.getElementById('pedalCandidate').options.length"),1);
  assert.equal(await evaluate('mapping.accelInput'),'none','Detection does not apply an unconfirmed pedal');
  await evaluate("window.testPad.axes[1]=1;document.getElementById('pedalApply').click()");await wait(120);
  assert.equal(await evaluate('mapping.accelInput'),'axis:1');
  assert.equal(await evaluate('mapping.accelRest'),1);assert.equal(await evaluate('mapping.accelFull'),-.8);
  assert.equal(await evaluate('autoArm.paused'),true,'Saving calibration requires explicit resume');
  assert.equal(await evaluate("document.getElementById('accelMeter').value"),0);
  await arm();await update('window.testPad.axes[1]=-.8');
  await until("window.apiCalls.some(c=>c.path==='/api/control'&&c.body.throttle===1&&c.body.steering===0)");
  await evaluate("document.getElementById('stop').click()");await until('!controlClient.stopping');
  await update('window.testPad.axes[1]=1');
  await evaluate("document.querySelector('[data-setup-pedal=brake]').click();document.getElementById('pedalReleased').click();window.testPad.buttons[1].value=.72;document.getElementById('pedalPressed').click();window.testPad.buttons[1].value=0;document.getElementById('pedalApply').click()");
  assert.equal(await evaluate('mapping.accelInput'),'axis:1','Brake setup preserves accelerator');
  assert.equal(await evaluate('mapping.brakeInput'),'button:1');
  await update('window.testPad.axes[1]=-.8;window.testPad.buttons[1].value=.72');
  assert.match(await evaluate("document.getElementById('pedalStatus').textContent"),/cancels throttle/);
  assert.equal(await evaluate("document.getElementById('requestedThrottle').textContent"),'0%');
  await update('window.testPad.axes[1]=1;window.testPad.buttons[1].value=0');
  await navigate('/','carDiagram');
  assert.equal(await evaluate('mapping.accelInput'),'axis:1','Guided calibration survives reload');
  assert.equal(await evaluate('mapping.accelFull'),-.8);
  await evaluate("document.getElementById('accelInput').value='axis:0';document.getElementById('accelInput').onchange();window.testPad.axes[0]=1;document.querySelector('[data-calibrate=accelRest]').click();window.testPad.axes[0]=-.8;document.querySelector('[data-calibrate=accelFull]').click()");
  await wait(100);assert.equal(await evaluate('RCMapping.loadSettings().accelFull'),-.8);
  await evaluate("window.testPad.axes[0]=1;document.querySelector('[data-calibrate=accelFull]').click()");assert.equal(await evaluate('RCMapping.loadSettings().accelFull'),-.8);
  await navigate('/','carDiagram');assert.equal(await evaluate('RCMapping.loadSettings().accelFull'),-.8);
  await until("document.getElementById('connectionBadge').dataset.online==='true'");
  for(const [width,height,name] of [[1440,1100,'controller-desktop.png'],[390,1000,'controller-mobile.png']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await wait(120);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal overflow at '+width);
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile('artifacts/'+name,Buffer.from(screenshot.data,'base64'));
  }
  await navigate('/test','rawButtons');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await send('Page.navigate',{url:base+'/wiring'});await until("location.pathname==='/wiring'&&document.readyState==='complete'&&!!document.querySelector('img')");
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  assert.deepEqual(errors,[],'No browser runtime exceptions');
  console.log('Browser QA passed: fresh held steering during suspended preview, immediate Button 0 stop/reason, guided accelerator/brake setup, inverted axis throttle, setup arm guard, calibration persistence, diagram, brake rumble, 50 ms commands, neutral guard, dry run, reverse, disconnect, keyboard, focus loss, limit change, routes and mobile layout.');
}finally{
  await evaluate("navigator.sendBeacon('/api/stop','{}')").catch(()=>{});
  await send('Browser.close').catch(()=>{});ws.close();
}
