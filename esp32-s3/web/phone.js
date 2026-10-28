'use strict';
const $=id=>document.getElementById(id),phoneInput=new RCPhone.PhoneInput();
let active=!document.hidden,motionAllowed=false,lastMotion=-Infinity,espConnected=false,remoteArmed=false,armPending=false,armEpoch=0;
Object.assign(phoneInput,RCPhone.loadSettings());
$('limit').value=Math.round(phoneInput.limit*100);$('limitValue').textContent=$('limit').value+'%';$('invert').checked=phoneInput.invert;
function save(){try{localStorage.setItem(RCPhone.settingsKey,JSON.stringify({limit:phoneInput.limit,invert:phoneInput.invert}))}catch{}}
function screenAngle(){return Number(screen.orientation?.angle??window.orientation??0)}
function heldUI(){for(const [id,direction] of [['reverse',-1],['accelerate',1]])$(id).classList.toggle('held',[...phoneInput.pointers.values()].includes(direction))}
const controlClient=new RCControls.ControlSession({
  getInput:()=>{if(!active||document.hidden)throw Error('Phone is inactive; disarmed');return phoneInput.sample(performance.now())},
  onState:state=>{globalThis.RCBattery?.render($('carBattery'),state);espConnected=!!state.connected;remoteArmed=!!(state.remoteArmed??state.armed);$('connection').textContent=state.connected?(state.output_enabled?'CONNECTED':'DRY RUN'):'OFFLINE';$('connection').dataset.connected=String(!!state.connected);$('mode').textContent=state.message||'Hold either side to drive. Release to stop.';$('commandTimeoutStatus').textContent=state.connected?RCControls.commandTimeoutText(state):'ESP command timeout: checking connection.'},
  onStatus:message=>{$('status').textContent=message},
  onStop:()=>{phoneInput.clear();heldUI()}
});
function stop(message,force=false){armEpoch++;armPending=false;phoneInput.clear();heldUI();return controlClient.stop({message,force})}
function armIssue(){return phoneInput.armIssue(performance.now(),{active:active&&!document.hidden,connected:espConnected,otherController:remoteArmed&&!controlClient.armed})}
$('stop').onclick=()=>stop('Emergency stop. Release both sides and re-arm.',true);
for(const id of ['dashboardLink','setupLink'])$(id).addEventListener('click',()=>stop());
$('enableMotion').onclick=async()=>{
  stop();
  motionAllowed=false;phoneInput.enabled=false;phoneInput.rotate();lastMotion=-Infinity;
  if(!window.isSecureContext){$('status').textContent='Open the phone HTTPS link from start-mobile.cmd and trust its local certificate first.';return}
  const permissions=[];
  // Both permission calls must start in this button's user gesture (Safari/iOS).
  for(const type of [window.DeviceMotionEvent,window.DeviceOrientationEvent]){
    if(typeof type?.requestPermission==='function'){
      try{permissions.push(Promise.resolve(type.requestPermission()))}catch(error){permissions.push(Promise.reject(error))}
    }
  }
  const results=await Promise.allSettled(permissions);
  if(results.length&&!results.some(result=>result.status==='fulfilled'&&result.value==='granted')){
    $('status').textContent='Motion permission denied. Allow Motion & Orientation in browser settings, then try Enable tilt.';return;
  }
  if(!window.DeviceMotionEvent&&!window.DeviceOrientationEvent){$('status').textContent='This browser does not expose phone motion sensors.';return}
  motionAllowed=true;phoneInput.enabled=true;phoneInput.rotate();
  $('status').textContent='Move the phone slightly, hold it comfortably, then tap Set centre.';
  setTimeout(()=>{if(motionAllowed&&!phoneInput.fresh(performance.now()))$('status').textContent='No tilt data received. Check motion permission and the trusted HTTPS connection.'},2000);
};
window.addEventListener('devicemotion',event=>{
  if(!motionAllowed||!active||document.hidden)return;
  const now=performance.now();
  if(phoneInput.gravity(event.accelerationIncludingGravity,screenAngle(),now))lastMotion=now;
});
window.addEventListener('deviceorientation',event=>{
  if(!motionAllowed||!active||document.hidden||performance.now()-lastMotion<250)return;
  phoneInput.orientation(event.beta,event.gamma,screenAngle(),performance.now());
});
$('centre').onclick=()=>{stop();$('status').textContent=phoneInput.calibrate(performance.now())?'Centre saved. Release both sides, then Arm.':'Waiting for fresh tilt data. Tap Enable tilt.'};
$('arm').onclick=async()=>{
  if(controlClient.armed||controlClient.arming||armPending)return;
  const initialIssue=armIssue();
  if(initialIssue){$('status').textContent=initialIssue;return}
  const ticket=++armEpoch;armPending=true;
  try{
    const deadline=performance.now()+1500;
    while(controlClient.busy||controlClient.stopping){
      $('status').textContent='Waiting for the connection check to finish…';
      await new Promise(resolve=>setTimeout(resolve,20));
      if(ticket!==armEpoch)return;
      if(performance.now()>=deadline){$('status').textContent='Connection check is taking too long. Release the controls and try Arm again.';return}
    }
    if(ticket!==armEpoch)return;
    const issue=armIssue();
    if(issue){$('status').textContent=issue;return}
    const armed=await controlClient.arm();
    if(armed&&ticket===armEpoch)$('status').textContent='Armed. Tilt to steer; hold left to reverse or right to accelerate.';
  }finally{if(ticket===armEpoch)armPending=false}
};
for(const [id,direction] of [['reverse',-1],['accelerate',1]]){
  const button=$(id);
  button.addEventListener('pointerdown',event=>{
    event.preventDefault();if(!controlClient.armed||!active||event.button>0)return;
    button.setPointerCapture(event.pointerId);
    if(!phoneInput.press(event.pointerId,direction)){stop('Both sides pressed. Release and re-arm.');return}
    heldUI();controlClient.poll();
  });
  button.addEventListener('pointerup',event=>{event.preventDefault();phoneInput.release(event.pointerId);heldUI();controlClient.poll()});
  button.addEventListener('pointercancel',()=>stop('Touch interrupted. Re-arm to continue.'));
  button.addEventListener('lostpointercapture',event=>{if(phoneInput.pointers.has(event.pointerId))stop('Touch released. Re-arm to continue.')});
  button.addEventListener('pointermove',event=>{
    if(!phoneInput.pointers.has(event.pointerId))return;
    const rect=button.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)stop('Finger left the button. Re-arm to continue.');
  });
  button.addEventListener('contextmenu',event=>event.preventDefault());
}
$('limit').oninput=()=>{stop();phoneInput.limit=Number($('limit').value)/100;$('limitValue').textContent=$('limit').value+'%';save()};
$('invert').onchange=()=>{stop();phoneInput.invert=$('invert').checked;save()};
function rotate(){stop('Screen rotated. Hold comfortably and set centre again.');phoneInput.rotate()}
screen.orientation?.addEventListener('change',rotate);window.addEventListener('orientationchange',rotate);
window.addEventListener('blur',()=>{active=false;stop('Phone lost focus. Re-arm to continue.')});
window.addEventListener('focus',()=>{active=!document.hidden});
document.addEventListener('visibilitychange',()=>{active=!document.hidden;if(!active)stop('Phone hidden. Re-arm to continue.')});
window.addEventListener('pagehide',()=>{phoneInput.clear();controlClient.beaconStop()});
function render(){
  const fresh=phoneInput.fresh(performance.now());
  if(controlClient.armed&&!fresh)stop('Tilt data stopped. Enable tilt, set centre, and re-arm.');
  $('centre').disabled=!fresh;
  $('arm').disabled=controlClient.armed||controlClient.arming||armPending;
  $('arm').textContent=controlClient.armed?'ARMED':armPending?'ARMING…':'3 · Arm';
  $('armHint').textContent=controlClient.armed?'Armed. Release either drive button to stop output.':armPending?'Checking fresh neutral input before arming…':armIssue()||'Ready to arm. Keep the phone centred and release both drive buttons.';
  for(const id of ['reverse','accelerate'])$(id).disabled=!controlClient.armed;
  const steering=fresh&&phoneInput.calibrated?phoneInput.steering():0;
  $('wheel').style.transform=`rotate(${steering*65}deg)`;
  $('tiltValue').textContent=phoneInput.calibrated?`${Math.round(steering*100)}% STEER`:'CENTRE PHONE';
  $('driveValue').textContent=phoneInput.pointers.size?([...phoneInput.pointers.values()][0]>0?'FORWARD':'REVERSE'):'RELEASED';
  requestAnimationFrame(render);
}
stop();requestAnimationFrame(render);
