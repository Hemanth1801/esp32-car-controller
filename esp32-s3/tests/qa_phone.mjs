import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const pages=await(await fetch('http://127.0.0.1:9337/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let next=0;const pending=new Map(),errors=[];
ws.onclose=()=>{for(const task of pending.values())task.reject(Error('Browser closed'));pending.clear()};
ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.id&&pending.has(message.id)){const task=pending.get(message.id);pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(50)}throw Error('Timed out: '+expression)}
async function click(id){await until(`!document.getElementById('${id}').disabled`);await evaluate(`document.getElementById('${id}').click()`)}
async function neutral(){await evaluate('window.mockGravity={x:0,y:0,z:9.81};window.emitMotion=true');await wait(450);await click('centre');await until('!controlClient.stopping');await click('arm');await until('controlClient.armed')}
const rect=id=>evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*.75}})()`);
const touch=(type,points=[])=>send('Input.dispatchTouchEvent',{type,touchPoints:points.map(point=>({radiusX:5,radiusY:5,force:1,...point}))});
try{
  await send('Page.enable');await send('Runtime.enable');await send('Security.enable');await send('Security.setIgnoreCertificateErrors',{ignore:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.permissionResult='granted';window.permissionCalls=0;window.mockGravity={x:0,y:0,z:9.81};window.emitMotion=true;window.apiCalls=[];
    for(const type of [window.DeviceMotionEvent,window.DeviceOrientationEvent])if(type)Object.defineProperty(type,'requestPermission',{value:()=>{window.permissionCalls++;return Promise.resolve(window.permissionResult)},configurable:true});
    setInterval(()=>{if(window.emitMotion&&window.DeviceMotionEvent)window.dispatchEvent(new DeviceMotionEvent('devicemotion',{accelerationIncludingGravity:window.mockGravity,interval:20}))},20);
    const originalFetch=window.fetch;window.fetch=(path,options)=>{window.apiCalls.push({path:String(path),body:options?.body?JSON.parse(options.body):null});return originalFetch(path,options)};
  `});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  await send('Page.navigate',{url:'https://127.0.0.1:9543/phone'});
  await until("document.readyState==='complete'&&typeof phoneInput!=='undefined'");
  assert.equal(await evaluate('isSecureContext'),true);
  await click('enableMotion');await until('phoneInput.fresh(performance.now())&&espConnected');assert.ok(await evaluate('window.permissionCalls>=1'));
  await click('arm');assert.match(await evaluate("document.getElementById('status').textContent"),/Set centre first/,'Uncalibrated Arm shows the missing step');
  await neutral();
  // A read-only status request must not swallow the Arm tap. Delay just the
  // browser's mock status response, then verify a fresh neutral arm afterward.
  await evaluate("document.getElementById('stop').click()");await until('!controlClient.stopping');
  await evaluate(`window.savedControlFetcher=controlClient.fetcher;window.statusDelay=250;controlClient.fetcher=async(...args)=>{const response=await savedControlFetcher(...args);if(args[0]==='/api/status'&&window.statusDelay)await new Promise(resolve=>setTimeout(resolve,window.statusDelay));return response};controlClient.lastStatus=-Infinity;controlClient.poll()`);
  await until('controlClient.busy');await click('arm');await until('controlClient.armed');
  await evaluate('window.statusDelay=0');
  await evaluate("document.getElementById('stop').click()");await until('!controlClient.stopping');
  // Emergency Stop cancels an Arm tap waiting on a delayed connection check.
  const armsBeforeCancel=await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length");
  await until("!document.getElementById('arm').disabled");
  await evaluate("window.statusDelay=250;controlClient.lastStatus=-Infinity;controlClient.poll();document.getElementById('arm').click();if(!armPending)throw Error('Arm tap did not enter pending state');document.getElementById('stop').click()");
  await wait(400);assert.equal(await evaluate('controlClient.armed'),false);
  assert.equal(await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length"),armsBeforeCancel,'Cancelled pending Arm must never be sent');
  await until("!document.getElementById('arm').disabled");
  await evaluate("window.statusDelay=250;controlClient.lastStatus=-Infinity;controlClient.poll();document.getElementById('arm').click();window.mockGravity={x:-4.905,y:0,z:8.4957}");
  await until('!armPending&&!controlClient.busy');
  assert.equal(await evaluate('controlClient.armed'),false,'Phone must still be centred when the connection check finishes');
  assert.equal(await evaluate("window.apiCalls.filter(c=>c.path==='/api/arm').length"),armsBeforeCancel);
  assert.match(await evaluate("document.getElementById('status').textContent"),/saved centre/);
  await evaluate('window.statusDelay=0;controlClient.fetcher=window.savedControlFetcher');
  await neutral();
  const forward=await rect('accelerate'),reverse=await rect('reverse');
  await touch('touchStart',[{id:1,...forward}]);await until("window.apiCalls.some(c=>c.path==='/api/control'&&c.body.throttle===1)");
  await evaluate('window.mockGravity={x:-4.905,y:0,z:8.4957}');
  await until("window.apiCalls.some(c=>c.path==='/api/control'&&c.body.steering>.25)");
  await touch('touchEnd');await until('phoneInput.pointers.size===0');
  await until("window.apiCalls.filter(c=>c.path==='/api/control').at(-1)?.body.throttle===0");assert.equal(await evaluate('controlClient.armed'),true,'Normal release should remain armed');
  await touch('touchStart',[{id:2,...reverse}]);await until("window.apiCalls.some(c=>c.path==='/api/control'&&c.body.throttle===-1)");await touch('touchEnd');
  await touch('touchStart',[{id:3,...reverse},{id:4,...forward}]);await until('!controlClient.armed');assert.equal(await evaluate('phoneInput.pointers.size'),0);await touch('touchEnd');
  await neutral();await touch('touchStart',[{id:5,...forward}]);await touch('touchCancel');await until('!controlClient.armed');
  await neutral();await evaluate('window.emitMotion=false');await until('!controlClient.armed');assert.match(await evaluate("document.getElementById('status').textContent"),/Tilt data|tilt data/i);
  await evaluate('window.emitMotion=true');await neutral();
  await evaluate("Object.defineProperty(screen.orientation,'angle',{value:90,configurable:true});screen.orientation.dispatchEvent(new Event('change'))");await until('!controlClient.armed&&!phoneInput.calibrated');
  await neutral();await evaluate("window.dispatchEvent(new Event('blur'))");await until('!controlClient.armed');await evaluate("window.dispatchEvent(new Event('focus'))");
  await evaluate("window.permissionResult='denied'");await click('enableMotion');await until("document.getElementById('status').textContent.includes('denied')");assert.equal(await evaluate('phoneInput.enabled'),false);await click('arm');assert.match(await evaluate("document.getElementById('status').textContent"),/Enable tilt/);assert.equal(await evaluate('controlClient.armed'),false);
  await evaluate("window.permissionResult='granted'");await click('enableMotion');await neutral();
  await evaluate("document.getElementById('stop').click()");await until('!controlClient.armed');
  for(const [width,height,name] of [[390,844,'phone-portrait.png'],[844,390,'phone-landscape.png']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await wait(120);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal overflow');
    assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight+1'),'Controls must fit the phone screen');
    assert.ok(await evaluate("(()=>{const r=document.getElementById('stop').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()"),'Emergency stop stays visible');
    const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile('artifacts/'+name,Buffer.from(image.data,'base64'));
  }
  assert.deepEqual(errors,[]);
  console.log('Phone HTTPS browser QA passed: Arm readiness messages, delayed status wait, pending Arm cancellation and neutral recheck, motion permission, tilt steering, hold forward/reverse, release, conflicting fingers, pointer cancellation, stale sensors, screen rotation, focus loss, permission denial, emergency stop, portrait and landscape.');
}finally{await evaluate("navigator.sendBeacon('/api/stop','{}')").catch(()=>{});await send('Browser.close').catch(()=>{});ws.close()}
