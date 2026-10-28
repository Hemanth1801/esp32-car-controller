'use strict';
const $=id=>document.getElementById(id),preview=$('preview'),capture=document.createElement('canvas');
capture.width=640;capture.height=360;
const context=capture.getContext('2d',{alpha:false});
let stream=null,publishing=false,session='',generation=0,wakeLock=null;
async function cameraRequest(path,headers={}){
  const response=await fetch(path,{method:'POST',headers,signal:AbortSignal.timeout(1200)}),data=await response.json();
  if(!response.ok)throw Error(data.error||'Camera relay unavailable');return data;
}
async function stopCamera(message='Camera stopped.'){
  generation++;publishing=false;
  const previous=session;session='';
  stream?.getTracks().forEach(track=>track.stop());stream=null;preview.srcObject=null;
  wakeLock?.release().catch(()=>{});wakeLock=null;
  $('startCamera').disabled=false;$('stopCamera').disabled=true;$('cameraStatus').textContent=message;
  if(previous)cameraRequest('/api/video/stop',{'X-Camera-Session':previous}).catch(()=>{});
}
async function publish(ticket){
  let previousTime=-1,frames=0;
  while(publishing&&ticket===generation){
    const began=performance.now();
    try{
      if(document.hidden||!stream?.active)throw Error('Camera page inactive. Restart the camera.');
      if(preview.readyState>=2&&preview.currentTime!==previousTime){
        previousTime=preview.currentTime;
        context.drawImage(preview,0,0,capture.width,capture.height);
        const blob=await new Promise(resolve=>capture.toBlob(resolve,'image/jpeg',.65));
        if(!publishing||ticket!==generation)return;
        if(!blob||performance.now()-began>300)throw Error('Camera capture too slow. Restart camera.');
        const response=await fetch('/api/video/frame',{method:'POST',body:blob,headers:{'Content-Type':'image/jpeg','X-Camera-Session':session,'X-Capture-Age-Ms':String(Math.ceil(performance.now()-began))},signal:AbortSignal.timeout(800)});
        if(!response.ok){const data=await response.json();throw Error(data.error||'Video upload failed')}
        if(ticket!==generation)return;
        $('cameraStatus').textContent=`LIVE · ${++frames} frames sent · 640 × 360 · up to 10 fps`;
      }
    }catch(error){if(ticket===generation)await stopCamera(error.message);return}
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,100-(performance.now()-began))));
  }
}
$('startCamera').onclick=async()=>{
  if(publishing||$('startCamera').disabled)return;
  const ticket=++generation;$('startCamera').disabled=true;
  try{
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Camera needs trusted HTTPS. Open the HTTPS camera link and trust the local certificate first.');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:360},frameRate:{ideal:10,max:15}}});
    if(ticket!==generation){acquired.getTracks().forEach(track=>track.stop());return}
    stream=acquired;preview.srcObject=stream;await preview.play();
    const result=await cameraRequest('/api/video/start');
    if(ticket!==generation){cameraRequest('/api/video/stop',{'X-Camera-Session':result.camera_session}).catch(()=>{});return}
    session=result.camera_session;publishing=true;$('stopCamera').disabled=false;
    stream.getVideoTracks()[0].addEventListener('ended',()=>stopCamera('Camera disconnected. Restart it.'));
    stream.getVideoTracks()[0].addEventListener('mute',()=>stopCamera('Camera paused. Restart it.'));
    navigator.wakeLock?.request('screen').then(lock=>{if(ticket===generation)wakeLock=lock;else lock.release()}).catch(()=>{});
    publish(ticket);
  }catch(error){if(ticket===generation)await stopCamera(error.message)}
};
$('stopCamera').onclick=()=>stopCamera();
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera('Page hidden; camera stopped. Keep this page visible.')});
window.addEventListener('pagehide',()=>stopCamera('Camera page closed.'));
