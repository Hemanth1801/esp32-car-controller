import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const pages=await(await fetch('http://127.0.0.1:9227/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let id=0;const pending=new Map(),errors=[];
ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);if(data.id&&pending.has(data.id)){const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(Error(data.error.message)):task.resolve(data.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}))});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression){for(let n=0;n<120;n++){if(await evaluate(expression))return;await wait(40)}throw Error('Timed out: '+expression+' '+JSON.stringify(await evaluate('({message,armed:client.armed,connected,lastVideoError,frame:input.lastFrame,now:performance.now()})')))}
async function button(index){await evaluate(`testRight.gamepad.buttons[${index}].value=1`);await wait(100);await evaluate(`testRight.gamepad.buttons[${index}].value=0`);await wait(100)}
async function armLive(){await until('!client.busy&&!client.stopping&&videoFresh()&&performance.now()-lastVideo<250&&input.visible&&performance.now()-input.lastFrame<100&&!input.previousArm');await button(4);await until('client.armed')}
const injection=`
window.apiCalls=[];
const realFetch=window.fetch;window.fetch=(path,options)=>{if(['/api/arm','/api/control','/api/stop'].includes(path))window.apiCalls.push({path,body:options?.body?JSON.parse(options.body):null});return realFetch(path,options)};
window.makeSource=hand=>({handedness:hand,profiles:['oculus-touch-v3'],targetRayMode:'tracked-pointer',gripSpace:{},gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:6},()=>({value:0}))}});
window.testLeft=makeSource('left');window.testRight=makeSource('right');window.xrFrames=true;window.xrTracking=true;
window.MockSession=class extends EventTarget{
 constructor(){super();this.visibilityState='visible';this.inputSources=[testLeft,testRight]}
 async requestReferenceSpace(){return new EventTarget()}
 updateRenderState(state){this.renderState=state}
 requestAnimationFrame(callback){if(!window.xrFrames)return;return setTimeout(()=>callback(performance.now(),{session:this,getPose:()=>window.xrTracking?{}:null,getViewerPose:()=>window.xrTracking?{views:[{projectionMatrix:new Float32Array([1,0,0,0,0,1.5,0,0,0,0,-1,-1,0,0,-.1,0]),transform:{inverse:{matrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}}}]}:null}),16)}
 async end(){this.dispatchEvent(new Event('end'))}
};
Object.defineProperty(navigator,'xr',{value:{isSessionSupported:async()=>true,requestSession:async()=>new MockSession()},configurable:true});
WebGLRenderingContext.prototype.makeXRCompatible=async()=>{};
window.XRWebGLLayer=class{constructor(session,gl){this.framebuffer=null;this.gl=gl}getViewport(){return{x:0,y:0,width:this.gl.canvas.width,height:this.gl.canvas.height}}};
window.cameraPaused=false;window.cameraBusy=false;
window.testPushVideo=async()=>{
 if(window.cameraPaused||window.cameraBusy)return;window.cameraBusy=true;
 try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d');c.fillStyle='#3e91c2';c.fillRect(0,0,320,90);c.fillStyle='#467347';c.fillRect(0,90,320,90);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.7));await realFetch('/api/video/frame',{method:'POST',body:blob,headers:{'Content-Type':'image/jpeg','X-Camera-Session':window.cameraToken,'X-Capture-Age-Ms':'0'}})}finally{window.cameraBusy=false}
};
window.testStartVideo=async()=>{const response=await realFetch('/api/video/start',{method:'POST'});window.cameraToken=(await response.json()).camera_session;window.cameraPaused=false;await testPushVideo();window.cameraTimer=setInterval(testPushVideo,70)};
`;
try{
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:injection});
  await send('Emulation.setDeviceMetricsOverride',{width:1360,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8766/quest'});
  await until('document.readyState==="complete"&&typeof renderer!=="undefined"&&renderer&&connected');
  await until('!document.getElementById("enterVR").disabled');
  assert.equal(await evaluate('renderer.gl.getError()'),0);
  await evaluate('document.getElementById("enterVR").click()');await until('!!xrSession&&input.lastFrame>0');
  assert.equal(await evaluate('mode'), 'practice');
  await evaluate('connected=false');await button(4);await until('practiceArmed');
  await evaluate('testRight.gamepad.buttons[1].value=1;testRight.gamepad.buttons[0].value=.54;testLeft.gamepad.axes[2]=.56');
  await until('Math.abs(lastInput.throttle-.5)<.001&&Math.abs(lastInput.steering-.5)<.001');
  await until('Math.abs(renderer.lastWheelAngle+.6)<.001');
  await wait(250);assert.equal(await evaluate('apiCalls.length'),0,'Practice A, stick and triggers send no motor commands even without video or ESP');
  await send('Page.captureScreenshot',{format:'png'}).then(result=>fs.writeFile('artifacts/quest-practice.png',Buffer.from(result.data,'base64')));
  await button(5);await until('!practiceArmed');assert.equal(await evaluate('apiCalls.length'),0,'Practice B does not stop another real controller');
  await evaluate('testRight.gamepad.buttons[1].value=0;testRight.gamepad.buttons[0].value=0;testLeft.gamepad.axes[2]=0;connected=true;document.getElementById("driveMode").value="live";document.getElementById("driveMode").dispatchEvent(new Event("change"))');
  await button(4);assert.equal(await evaluate('client.armed'),false,'No camera must prevent live arm');
  await evaluate('testStartVideo()');await until('videoFresh()');
  await evaluate('document.getElementById("driveMode").value="practice";document.getElementById("driveMode").dispatchEvent(new Event("change"))');
  await button(4);await until('practiceArmed');await wait(200);
  assert.equal(await evaluate('mode'),'practice');assert.equal(await evaluate('apiCalls.length'),0,'Fresh video never silently enables live control');
  await evaluate('document.getElementById("driveMode").value="live";document.getElementById("driveMode").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('practiceArmed||client.armed'),false,'Changing modes disarms and requires a fresh A press');
  await until('!client.busy&&!client.stopping');await armLive();
  await evaluate('testRight.gamepad.buttons[1].value=1;testRight.gamepad.buttons[0].value=.54;testLeft.gamepad.axes[2]=.56');
  await until('apiCalls.some(c=>c.path==="/api/control"&&Math.abs(c.body.throttle-.5)<.001&&Math.abs(c.body.steering-.5)<.001)');
  await evaluate('testRight.gamepad.buttons[1].value=0');
  await until('apiCalls.at(-1).path==="/api/control"&&apiCalls.at(-1).body.throttle===0&&apiCalls.at(-1).body.steering===0');
  assert.equal(await evaluate('client.armed'),true,'Grip release zeros output without dropping ownership');
  await button(5);await until('!client.armed&&!client.stopping');
  const before=await evaluate('apiCalls.filter(c=>c.path==="/api/arm").length');
  await button(4);assert.equal(await evaluate('client.armed'),false,'Grip release cannot mask non-neutral arm');
  assert.equal(await evaluate('apiCalls.filter(c=>c.path==="/api/arm").length'),before);
  await evaluate('testRight.gamepad.buttons[0].value=0;testLeft.gamepad.axes[2]=0');await armLive();
  await evaluate('testRight.gamepad.buttons[1].value=1;testLeft.gamepad.buttons[0].value=1');
  await until('apiCalls.some(c=>c.path==="/api/control"&&c.body.throttle<-.99)');
  await evaluate('cameraPaused=true');await until('!client.armed');await wait(400);
  await evaluate('cameraPaused=false');await until('videoFresh()');await wait(200);assert.equal(await evaluate('client.armed'),false,'Video reconnection must not auto-arm');
  await evaluate('testLeft.gamepad.buttons[0].value=0;testRight.gamepad.buttons[1].value=0');await armLive();
  await evaluate('xrSession.visibilityState="visible-blurred";xrSession.dispatchEvent(new Event("visibilitychange"))');await until('!client.armed');
  await evaluate('xrSession.visibilityState="visible";xrSession.dispatchEvent(new Event("visibilitychange"))');await wait(100);await until('!client.busy&&!client.stopping');await armLive();
  await evaluate('xrFrames=false');await until('!client.armed');await wait(200);
  await evaluate('xrFrames=true;xrSession.requestAnimationFrame(xrFrame)');await wait(100);await armLive();
  await evaluate('xrTracking=false');await until('!client.armed');
  await evaluate('xrTracking=true');await wait(100);await armLive();
  await evaluate('xrSession.inputSources=[testLeft];xrSession.dispatchEvent(new Event("inputsourceschange"))');await until('!client.armed');
  await evaluate('xrSession.inputSources=[testLeft,testRight];xrSession.dispatchEvent(new Event("inputsourceschange"))');await wait(150);await armLive();
  await evaluate('document.getElementById("limit").value=30;document.getElementById("limit").dispatchEvent(new Event("input"))');await until('!client.armed');
  await armLive();await evaluate('testRight.gamepad.buttons[1].value=1;testRight.gamepad.buttons[0].value=1;testLeft.gamepad.axes[2]=1');
  await until('apiCalls.some(c=>c.path==="/api/control"&&Math.abs(c.body.throttle-.3)<.001&&c.body.steering===1)');
  await evaluate('xrSession.end()');await until('!client.armed&&xrSession===null');
  assert.equal(await evaluate('renderer.gl.getError()'),0,'Preview and mocked XR render without GL errors');
  await send('Page.captureScreenshot',{format:'png'}).then(result=>fs.writeFile('artifacts/quest-preview.png',Buffer.from(result.data,'base64')));
  await evaluate('clearInterval(cameraTimer);fetch("/api/video/stop",{method:"POST",headers:{"X-Camera-Session":cameraToken}})');
  await send('Page.navigate',{url:'http://127.0.0.1:8766/camera'});
  await until('document.readyState==="complete"&&!!document.getElementById("startCamera")');
  await evaluate('document.getElementById("startCamera").click()');
  await until('typeof publishing!=="undefined"&&publishing&&document.getElementById("cameraStatus").textContent.startsWith("LIVE")');
  const frameResponse=await fetch('http://127.0.0.1:8766/api/video/frame');assert.equal(frameResponse.status,200);
  assert.equal(frameResponse.headers.get('Content-Type'),'image/jpeg');
  assert.equal(await evaluate('stream.getAudioTracks().length'),0);
  assert.equal(await evaluate('apiCalls.length'),0,'Phone camera page must not send motor commands');
  await evaluate('document.getElementById("stopCamera").click()');await until('!publishing&&stream===null');
  await wait(100);assert.equal((await fetch('http://127.0.0.1:8766/api/video/frame')).status,503);
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true})'});
  await send('Page.navigate',{url:'http://127.0.0.1:8766/quest'});
  await until('document.readyState==="complete"&&typeof renderer!=="undefined"&&!!renderer');
  assert.equal(await evaluate('document.getElementById("enterVR").disabled'),true,'Missing secure controller API disables VR without crashing the page');
  await evaluate('document.getElementById("stop").click()');await until('apiCalls.some(c=>c.path==="/api/stop")');
  assert.deepEqual(errors,[]);
  console.log('Quest browser QA passed: rendered cockpit/video, neutral arm, grip zero, drive/reverse, stop, video loss, XR visibility/frame/tracking/controller loss, power limit, no auto-resume; optional phone camera upload/stop with synthetic browser camera and no motor commands. Mock XR and simulated ESP only.');
}finally{
  await evaluate('client.stop({force:true});clearInterval(window.cameraTimer)').catch(()=>{});
  await send('Browser.close').catch(()=>{});ws.close();
}
