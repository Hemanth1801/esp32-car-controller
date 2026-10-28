import assert from 'node:assert/strict';
const pages=await(await fetch('http://127.0.0.1:9337/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let id=0;const pending=new Map(),errors=[];
ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);if(pending.has(data.id)){const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(Error(data.error.message)):task.resolve(data.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}))});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression){for(let n=0;n<100;n++){if(await evaluate(expression))return;await wait(50)}throw Error('Timed out: '+expression)}
try{
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.motorRequests=[];const originalFetch=window.fetch;window.fetch=(path,options)=>{if(['/api/arm','/api/control','/api/stop'].includes(path))motorRequests.push(path);return originalFetch(path,options)}`});
  await send('Page.navigate',{url:'http://127.0.0.1:8866/quest'});
  await until('typeof renderer!=="undefined"&&!!renderer?.wheelParts');
  assert.equal(await evaluate('document.getElementById("cameraOrientation").value'),'rotate180');
  const pixels=await evaluate(`(async()=>{
    renderer.preview=()=>{};
    const source=document.createElement('canvas');source.width=source.height=64;
    const context=source.getContext('2d');
    ['#ff0000','#00ff00','#0000ff','#ffff00'].forEach((color,i)=>{context.fillStyle=color;context.fillRect((i%2)*32,Math.floor(i/2)*32,32,32)});
    const blob=await new Promise(resolve=>source.toBlob(resolve,'image/jpeg',1));
    const bitmap=await createImageBitmap(blob,{imageOrientation:'flipY'});
    const r=renderer,g=r.gl;g.canvas.width=g.canvas.height=64;g.viewport(0,0,64,64);g.useProgram(r.program);g.disable(g.DEPTH_TEST);
    const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),full=new Float32Array([2,0,0,0,0,2,0,0,0,0,1,0,0,0,0,1]);
    const output={};
    for(const [kind,image] of [['canvas',source],['bitmap',bitmap]]){
      r.updateVideo(image);output[kind]={};
      for(const orientation of ['normal','rotate180','flipVertical','mirror']){
        r.setVideoOrientation(orientation);r.boundMesh=null;
        r.draw(identity,r.meshes.plane,full,[1,1,1,1],r.video,0,[1,1],r.videoFlip);
        output[kind][orientation]=[[16,48],[48,48],[16,16],[48,16]].map(([x,y])=>{const rgba=new Uint8Array(4);g.readPixels(x,y,1,1,g.RGBA,g.UNSIGNED_BYTE,rgba);return Array.from(rgba).slice(0,3)});
      }
    }
    bitmap.close();
    const draws=[],original=r.draw.bind(r);r.draw=(...args)=>{draws.push({texture:args[4]===r.practiceTexture?'practice':args[4]===r.blank?'blank':'other',flip:args[7]});original(...args)};
    r.scene(identity,identity,{practice:true,videoFresh:false,steering:0});
    r.scene(identity,identity,{practice:false,videoFresh:false,steering:0});r.draw=original;
    output.special=draws.filter(d=>d.texture!=='other');output.error=g.getError();return output;
  })()`);
  const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
  for(const kind of ['canvas','bitmap'])for(const [mode,order] of Object.entries({normal:[0,1,2,3],rotate180:[3,2,1,0],flipVertical:[2,3,0,1],mirror:[1,0,3,2]})){
    pixels[kind][mode].forEach((rgb,corner)=>rgb.forEach((channel,i)=>assert.ok(Math.abs(channel-colors[order[corner]][i])<8,`${kind} ${mode} corner ${corner}: ${rgb}`)));
  }
  assert.equal(pixels.error,0);
  assert.deepEqual(pixels.special,[{texture:'practice',flip:[1,1]},{texture:'blank',flip:[1,1]}]);
  await evaluate(`document.getElementById('cameraOrientation').value='normal';document.getElementById('cameraOrientation').dispatchEvent(new Event('change'))`);
  assert.deepEqual(await evaluate('renderer.videoFlip'),[1,1]);
  assert.deepEqual(await evaluate('motorRequests'),[]);
  await send('Page.reload');await until('typeof renderer!=="undefined"&&!!renderer?.wheelParts');
  assert.equal(await evaluate('document.getElementById("cameraOrientation").value'),'normal');
  await evaluate(`sessionStorage.setItem('espS3CarAutoArmPausedV1','true')`);
  await send('Page.navigate',{url:'http://127.0.0.1:8866/controls'});
  await until('document.readyState==="complete"&&document.getElementById("onboardVideo")?.style.transform');
  assert.equal(await evaluate('(()=>{const image=document.getElementById("onboardVideo");image.hidden=false;return getComputedStyle(image).transform})()'),'matrix(1, 0, 0, 1, 0, 0)');
  await evaluate(`document.getElementById('cameraOrientation').value='rotate180';document.getElementById('cameraOrientation').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate('(()=>{const image=document.getElementById("onboardVideo");image.hidden=false;return getComputedStyle(image).transform})()'),'matrix(-1, 0, 0, -1, 0, 0)');
  assert.deepEqual(await evaluate('motorRequests'),[]);assert.deepEqual(errors,[]);
  console.log('Camera orientation passed: all four corners for Canvas and JPEG/ImageBitmap; 180-degree default, separate vertical/mirror modes, persistence, desktop transform, upright Practice/lost-video panels, zero motor requests.');
}finally{await send('Browser.close').catch(()=>{});ws.close()}
