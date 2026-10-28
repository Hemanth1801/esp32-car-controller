'use strict';
const $=id=>document.getElementById(id),input=new RCQuest.QuestInput();
const secureControls=isSecureContext&&typeof crypto.randomUUID==='function';
let renderer=null,xrSession=null,referenceSpace=null,layer=null,connected=false,remoteArmed=false,message='Practice is ready. Enter VR, centre the left stick and press A.',lastVideo=-Infinity,lastSequence='',lastVideoError='',lastInput={throttle:0,steering:0},armTicket=0,timeoutOff=false,entering=false,mode='practice',practiceArmed=false;
try{const saved=JSON.parse(localStorage.getItem('espS3CarQuestV1')||'{}');input.limit=Math.max(.1,Math.min(1,Number(saved.limit)||1));input.invert=!!saved.invert}catch{}
$('limit').value=Math.round(input.limit*100);$('limitValue').textContent=$('limit').value+'%';$('invert').checked=input.invert;
const videoFresh=()=>performance.now()-lastVideo<=750;
const cameraOrientation=RCCameraOrientation.bind($('cameraOrientation'),mode=>{stop('Camera orientation changed. Press A at neutral to resume.');renderer?.setVideoOrientation(mode)});
const client=secureControls?new RCControls.ControlSession({
  getInput:()=>{if(mode!=='live')throw Error('Practice mode cannot send motor commands');if(document.hidden||!xrSession||xrSession.visibilityState!=='visible')throw Error('VR session inactive; disarmed');return input.read(performance.now(),{videoFresh:videoFresh()})},
  onState:state=>{globalThis.RCBattery?.render($('carBattery'),state);if(state.control_profile==='dual')$('deviceRoles').textContent=`Motors: ESP32 ${state.motor_device?.host||''} ? Camera: S3 ${state.camera_device?.host||''} (${state.camera_device?.connected?'connected':'waiting'})`;connected=!!state.connected;remoteArmed=!!(state.remoteArmed??state.armed);timeoutOff=state.command_timeout_enabled===false;$('connection').textContent=connected?(state.output_enabled?'ESP CONNECTED · MOTOR OUTPUT ENABLED':'ESP CONNECTED · DRY RUN'):'ESP OFFLINE';$('timeout').textContent=connected?RCControls.commandTimeoutText(state):'ESP connection unavailable.'},
  onStatus:text=>{message=text;$('status').textContent=text},
  onStop:()=>{armTicket++;lastInput={throttle:0,steering:0}}
}):{armed:false,arming:false,busy:false,stopping:null,beaconStop(){},async stop({force=false,message:reason}={}){message=reason;$('status').textContent=reason;if(force){try{await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(1000)})}catch{$('status').textContent='Stop could not reach the relay. Switch off motor power.'}}}};
function stop(reason,force=false){armTicket++;practiceArmed=false;lastInput={throttle:0,steering:0};return client.stop({force,message:reason})}
async function arm(){
  if(mode==='practice'){
    try{
      if(!xrSession||xrSession.visibilityState!=='visible'||document.hidden)throw Error('Enter VR before trying Practice.');
      if(!input.neutral(performance.now(),true))throw Error('Release both triggers and centre the left stick before pressing A.');
      practiceArmed=true;message='Practice armed. Hold right grip and try the stick/triggers. No motor commands are sent.';
    }catch(error){message=error.message}
    $('status').textContent=message;return;
  }
  if(client.armed||client.arming)return;
  const ticket=++armTicket;
  const issue=()=>{
    if(mode!=='live')return 'Session mode changed. Press A again.';
    if(!connected)return 'ESP is unavailable. Check shared Wi-Fi.';
    if(remoteArmed&&!client.armed)return 'Another controller is armed. Stop it before using Quest.';
    if(!xrSession||xrSession.visibilityState!=='visible')return 'Enter VR before arming.';
    try{if(!input.neutral(performance.now(),videoFresh()))return 'Release both triggers and centre the left stick before pressing A.'}catch(error){return error.message}
    return '';
  };
  let problem=issue();if(problem){message=problem;$('status').textContent=message;return}
  const deadline=performance.now()+1200;
  while(client.busy||client.stopping){await new Promise(resolve=>setTimeout(resolve,20));if(ticket!==armTicket)return;if(performance.now()>deadline){message='Connection busy. Release controls and press A again.';return}}
  if(ticket!==armTicket)return;problem=issue();
  if(problem){message=problem;return}
  await client.arm();
}
function state(){return {armed:mode==='practice'?practiceArmed:client.armed,practice:mode==='practice',...lastInput,message,videoFresh:videoFresh(),videoAge:performance.now()-lastVideo,timeoutOff}}
async function videoLoop(){
  while(true){
    const began=performance.now();
    try{
      if(document.hidden){await new Promise(resolve=>setTimeout(resolve,300));continue}
      const response=await fetch('/api/video/frame',{cache:'no-store',signal:AbortSignal.timeout(500)});
      if(!response.ok){const data=await response.json();throw Error(data.error||'No live camera')}
      const sequence=response.headers.get('X-Frame-Sequence'),age=Number(response.headers.get('X-Frame-Age-Ms'));
      if(sequence&&sequence!==lastSequence&&Number.isFinite(age)&&age>=0){
        const blob=await response.blob(),bitmap=await createImageBitmap(blob,{imageOrientation:'flipY'});
        const elapsed=performance.now()-began;
        if(age+elapsed<=500&&renderer){renderer.updateVideo(bitmap);lastVideo=performance.now()-age-elapsed;lastSequence=sequence;lastVideoError=''}
        bitmap.close();
      }
    }catch(error){lastVideoError=error.message}
    if(mode==='live'&&!videoFresh()&&(client.armed||client.arming))stop('Video stopped. Reconnect camera and press A at neutral.');
    $('videoState').textContent=mode==='practice'?'PRACTICE · NO MOTORS':videoFresh()?'LIVE VIDEO':'WAITING FOR CAMERA';
    await new Promise(resolve=>setTimeout(resolve,Math.max(20,100-(performance.now()-began))));
  }
}
function xrFrame(now,frame){
  const session=frame.session;if(session!==xrSession)return;
  session.requestAnimationFrame(xrFrame);
  try{
    input.visible=!document.hidden&&session.visibilityState==='visible';
    if(!input.visible)throw Error('Headset menu or visibility changed; disarmed');
    if(!frame.getViewerPose(referenceSpace))throw Error('Headset tracking lost; disarmed');
    const edges=input.update(session.inputSources,performance.now(),source=>!!frame.getPose(source.gripSpace||source.targetRaySpace,referenceSpace));
    if(edges.changed){stop('Touch controller changed; press A at neutral.');return}
    if(edges.stop){stop(mode==='practice'?'Practice stopped from B.':'Emergency stop from B. Press A at neutral to resume.',mode==='live')}
    else if(edges.arm){if(client.armed||client.arming||practiceArmed)stop('Disarmed from A.');else arm()}
    lastInput=input.read(performance.now(),{videoFresh:mode==='practice'||videoFresh()});
  }catch(error){lastInput={throttle:0,steering:0};if(client.armed||client.arming||practiceArmed)stop(error.message);else message=error.message}
  renderer.xr(frame,referenceSpace,layer,state(),performance.now());
}
async function enterVR(){
  if(entering||xrSession)return;entering=true;$('enterVR').disabled=true;
  let requested=null;
  try{
    // requestSession starts within the button gesture, before awaiting other work.
    requested=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local']});
    await renderer.gl.makeXRCompatible();
    if(document.hidden){await requested.end();return}
    xrSession=requested;input.clear();referenceSpace=await requested.requestReferenceSpace('local');
    referenceSpace.addEventListener('reset',()=>stop('VR reference reset; press A at neutral.'));
    layer=new XRWebGLLayer(requested,renderer.gl,{alpha:false,framebufferScaleFactor:1});requested.updateRenderState({baseLayer:layer});
    requested.addEventListener('visibilitychange',()=>{input.visible=requested.visibilityState==='visible';if(!input.visible)stop('Headset menu or visibility changed; disarmed.')});
    requested.addEventListener('inputsourceschange',()=>{input.clear();stop('Touch controller connection changed; press A at neutral.')});
    requested.addEventListener('end',()=>{stop('VR session ended; disarmed.');input.visible=false;input.clear();xrSession=null;referenceSpace=null;layer=null;$('leaveVR').disabled=true;$('enterVR').disabled=false});
    $('leaveVR').disabled=false;message='Release both triggers, centre left stick, then press A.';requested.requestAnimationFrame(xrFrame);
  }catch(error){message=error.message;$('status').textContent=message;if(requested)await requested.end().catch(()=>{});xrSession=null;$('enterVR').disabled=false}
  finally{entering=false;if(!xrSession)$('enterVR').disabled=false}
}
$('enterVR').onclick=enterVR;$('leaveVR').onclick=()=>{stop('Leaving VR; disarmed.');xrSession?.end()};$('stop').onclick=()=>stop('Emergency stop.',true);
$('driveMode').onchange=()=>{mode=$('driveMode').value==='live'?'live':'practice';stop(mode==='practice'?'Practice selected. Motor controls are disconnected.':'Live car selected. Fresh camera video and neutral A arming are required.');$('modeHint').textContent=mode==='practice'?'Practice stays inside this browser. A and B only change the simulation.':'Live motor control requires camera video, both tracked Touch controllers and a fresh A press.'};
for(const id of ['limit','invert'])$(id).addEventListener('input',()=>{stop('Settings changed; press A at neutral.');input.limit=Number($('limit').value)/100;input.invert=$('invert').checked;$('limitValue').textContent=$('limit').value+'%';try{localStorage.setItem('espS3CarQuestV1',JSON.stringify({limit:input.limit,invert:input.invert}))}catch{}});
document.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>stop('Navigating away; disarmed.')));
window.addEventListener('blur',()=>{if(!xrSession)stop('Page lost focus; disarmed.')});
document.addEventListener('visibilitychange',()=>{if(document.hidden){input.visible=false;stop('Quest page hidden; disarmed.')}});
window.addEventListener('pagehide',()=>client.beaconStop());
$('cockpit').addEventListener('cockpitlost',()=>{stop('Graphics context lost; reload before driving.');xrSession?.end()});
async function cameraSource(url,automatic=false){
  if(url!==undefined)await stop('Camera source changed; press A at neutral.');
  try{
    const options=url===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,auto_discover:automatic})};
    const response=await fetch('/api/video/source',{...options,signal:AbortSignal.timeout(2000)}),data=await response.json();
    if(!response.ok)throw Error(data.error||'Camera configuration failed');
    if(document.activeElement!==$('cameraUrl'))$('cameraUrl').value=data.url;
    $('cameraSourceStatus').textContent=(data.auto_discover?'AUTO · ':'')+data.message+(videoFresh()?' · Video ready. Select Live car when you are ready.':'');
  }catch(error){$('cameraSourceStatus').textContent=error.message}
}
$('cameraForm').onsubmit=event=>{event.preventDefault();lastVideo=-Infinity;cameraSource($('cameraUrl').value.trim())};
$('clearCamera').onclick=()=>{lastVideo=-Infinity;cameraSource('')};
$('autoCamera').onclick=()=>{lastVideo=-Infinity;cameraSource('',true)};
cameraSource();setInterval(()=>cameraSource(),3000);
// Also enforce freshness when XR callbacks stop arriving altogether.
setInterval(()=>{if((client.armed||client.arming||practiceArmed)&&((mode==='live'&&!videoFresh())||!input.visible||performance.now()-input.lastFrame>180))stop('Video or VR tracking stopped; disarmed.')},50);
(async()=>{
  try{renderer=new RCQuestRenderer.CockpitRenderer($('cockpit'))}catch(error){$('xrStatus').textContent=error.message;return}
  renderer.setVideoOrientation(cameraOrientation);
  function preview(now){if(!xrSession)renderer.preview(state(),now);requestAnimationFrame(preview)}requestAnimationFrame(preview);videoLoop();
  try{
    const supported=secureControls&&navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr');
    $('enterVR').disabled=!supported;$('xrStatus').textContent=supported?'Ready for immersive VR. Practice works without a camera or ESP connection.':'Open this page in Meta Quest Browser over trusted HTTPS. Desktop preview cannot control the car.';
  }catch(error){$('xrStatus').textContent='VR permission or certificate problem: '+error.message}
})();
