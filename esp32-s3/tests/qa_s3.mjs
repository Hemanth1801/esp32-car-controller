import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:8866';
const pages=await(await fetch('http://127.0.0.1:9337/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let id=0;const pending=new Map(),errors=[];
ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.id&&pending.has(message.id)){const task=pending.get(message.id);pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}))});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(50)}throw Error('Timed out: '+expression)}
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/controls'});
 await until("document.readyState==='complete'&&!!document.getElementById('onboardVideoStatus')");
 await until("document.getElementById('transportStatus').textContent.includes('Idle heartbeat every 50 ms')");
 await until("!document.getElementById('transportStatus').textContent.includes('pending')");
 assert.equal(await evaluate("document.getElementById('onboardVideo').hidden"),true);
 await evaluate(`(async()=>{window.videoToken=(await (await fetch('/api/video/start',{method:'POST'})).json()).camera_session;
  window.pushFrame=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');context.fillStyle='#26798c';context.fillRect(0,0,640,480);context.fillStyle='white';context.font='36px sans-serif';context.fillText('S3 camera simulation',110,240);const frame=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));await fetch('/api/video/frame',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Camera-Session':videoToken,'X-Capture-Age-Ms':'0'},body:frame})};
  await pushFrame();window.pushTimer=setInterval(pushFrame,100);})()`);
 await until("!document.getElementById('onboardVideo').hidden&&document.getElementById('onboardVideo').naturalWidth===640");
 await until("document.getElementById('onboardVideoStatus').textContent.includes('LIVE CAMERA')");
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile('artifacts/s3-desktop-video.png',Buffer.from(shot.data,'base64'));
 await evaluate('clearInterval(pushTimer)');
 await until("document.getElementById('onboardVideo').hidden");
 await evaluate("fetch('/api/video/stop',{method:'POST',headers:{'X-Camera-Session':videoToken}})");
 await send('Page.navigate',{url:base+'/wiring'});
 await until("document.readyState==='complete'&&document.querySelector('img')?.complete");
 assert.equal(await evaluate("document.querySelector('img').naturalWidth>0"),true);
 assert.equal(await evaluate("document.body.textContent.includes('Right, third from top')"),true);
 const wiring=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await fs.writeFile('artifacts/s3-wiring.png',Buffer.from(wiring.data,'base64'));
 assert.deepEqual(errors,[]);
 console.log('S3 browser passed: idle telemetry, live desktop JPEG, stale-frame hiding, physical wiring and no runtime errors.');
}finally{await send('Browser.close').catch(()=>{});ws.close()}
