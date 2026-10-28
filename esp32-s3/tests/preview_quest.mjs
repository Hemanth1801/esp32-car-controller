// Visual review helper: isolated fixture, Practice only, no motor API requests.
import fs from 'node:fs/promises';
const pages=await(await fetch('http://127.0.0.1:9337/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let id=0;const pending=new Map();
ws.onmessage=event=>{const data=JSON.parse(event.data);if(pending.has(data.id)){const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(Error(data.error.message)):task.resolve(data.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}))});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1150,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.motorRequests=[];const originalFetch=window.fetch;window.fetch=(path,options)=>{if(['/api/arm','/api/control','/api/stop'].includes(path))motorRequests.push(path);return originalFetch(path,options)}`});
  await send('Page.navigate',{url:'http://127.0.0.1:8866/quest'});
  let ready=false;
  for(let i=0;i<100;i++){if(await evaluate('typeof renderer!=="undefined"&&!!renderer?.wheelParts')){ready=true;break}await wait(60)}
  if(!ready)throw Error('Cockpit did not initialize');
  await wait(400);
  const rect=await evaluate('(()=>{const r=document.getElementById("cockpit").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');
  const cockpit=await send('Page.captureScreenshot',{format:'png',clip:rect});
  await fs.writeFile('artifacts/quest-gt-cockpit.png',Buffer.from(cockpit.data,'base64'));
  const page=await send('Page.captureScreenshot',{format:'png'});
  await fs.writeFile('artifacts/quest-gt-page.png',Buffer.from(page.data,'base64'));
  console.log(JSON.stringify(await evaluate('({glError:renderer.gl.getError(),cabinDrawCalls:renderer.parts.length,wheelDrawCalls:renderer.wheelParts.length,triangles:(renderer.parts.concat(renderer.wheelParts)).reduce((n,p)=>n+p.mesh.count/3,0),mode,motorRequests})')));
}finally{await send('Browser.close').catch(()=>{});ws.close()}
