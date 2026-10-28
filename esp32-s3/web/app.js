'use strict';
const $=id=>document.getElementById(id),session=new RCMapping.InputSession();
let mapping=RCMapping.loadSettings(),armed=false,keys=new Set(),currentPad=null,padSignature='',preview={throttle:0,steering:0},active=document.hasFocus()&&!document.hidden,espConnected=false,remoteArmed=false;
const autoPauseKey='espS3CarAutoArmPausedV1';
let autoPaused=false;try{autoPaused=sessionStorage.getItem(autoPauseKey)==='true'}catch{}
const autoArm=new RCAutoArm.AutoArmPolicy({paused:autoPaused});
function pauseAutomatic(value){autoArm.pause(value);try{sessionStorage.setItem(autoPauseKey,String(value))}catch{}}
const bindingIds=['steerInput','accelInput','brakeInput','stopInput','reverseInput'];
let pedalSetup=null;
const pedalNames={accel:'accelerator',brake:'brake / reverse pedal'};
const brakeRumble=new RCMapping.BrakeRumble(message=>{$('brakeRumbleStatus').textContent=message});
try{const reason=sessionStorage.getItem('espS3CarLastStopV1');if(reason)$('lastStop').textContent='Last disarm: '+reason}catch{}
const controlClient=new RCControls.ControlSession({
  getInput:readControlInput,
  onState:state=>{globalThis.RCBattery?.render($('carBattery'),state);armed=state.armed;espConnected=!!state.connected;remoteArmed=!!(state.remoteArmed??state.armed);serverDisplay(state);$('commandTimeoutStatus').textContent=state.connected?RCControls.commandTimeoutText(state):'ESP command timeout: checking connection.'},
  onStatus:message=>{$('status').textContent=message;$('arm').textContent=controlClient.armed?'Armed':'Arm inputs'},
  onStop:(reason,wasActive)=>{armed=false;keys.clear();preview={throttle:0,steering:0};brakeRumble.cancel();if(reason&&wasActive){$('lastStop').textContent='Last disarm: '+reason;try{sessionStorage.setItem('espS3CarLastStopV1',reason)}catch{}}}
});
function readControlInput(){
  if(!active||document.hidden||!document.hasFocus())throw Error('Driving page is inactive; disarmed');
  const pad=connected(),wheel=mapping.inputSource==='wheel'||(mapping.inputSource==='auto'&&!!pad?.connected);
  if(mapping.inputSource!=='keyboard'&&currentPad&&(!pad||currentPad.index!==pad.index||currentPad.id!==pad.id))throw Error('Wheel disconnected or selected controller changed; disarmed');
  if(controlClient.armed&&mapping.inputSource==='auto'&&!currentPad&&pad)throw Error('Input source changed to wheel; centre inputs and re-arm');
  if(wheel){
    if(!pad?.connected)throw Error('Wheel disconnected; disarmed');
    const error=RCMapping.steeringCalibrationError(mapping)||RCMapping.armBindingConflict(mapping);
    if(error)throw Error(error);
    if(bindingIds.some(id=>mapping[id]!=='none'&&RCMapping.read(pad,mapping[id])===null))throw Error('A mapped wheel input became unavailable; disarmed');
  }
  // Read the current device for every command. A held axis is valid even when
  // animation frames are delayed; never reuse the diagram's old preview value.
  const input=session.sample({pad,mapping,keys,source:mapping.inputSource});
  const reason=input.stop?'Mapped emergency-stop button pressed; disarmed.':
    controlClient.armed&&input.reverseChanged?'Forward/reverse selection changed; centre inputs and re-arm.':
    controlClient.armed&&input.armPressed?'Button 0: disarmed. Automatic arming paused until Button 0 or Arm is pressed again.':'';
  if(reason){pauseAutomatic(true);throw Error(reason)}
  currentPad=pad;preview={throttle:input.throttle*mapping.maxInput,steering:input.steering};
  return preview;
}
function serverDisplay(state){if(state.controller_label)document.querySelector('.eyebrow').textContent=state.controller_label;$('onboardVideo').dataset.cameraError=state.camera?.ready===false?(state.camera.message||'The ESP could not initialize its camera.'):'';$('transportStatus').textContent=state.connected?`${state.board||'S3'} · ${state.traffic_mode==='fresh-controls'?'Fresh inputs every 50 ms':state.traffic_mode==='idle-status'?'Motor status every 50 ms':'Idle heartbeat every 50 ms'} · Last idle acknowledgement ${state.heartbeat_age_ms===null||state.heartbeat_age_ms===undefined?'pending':state.heartbeat_age_ms+' ms ago'}`:'S3 offline · background discovery retries automatically';$('connectionBadge').textContent=state.connected?(state.output_enabled?'ESP CONNECTED':'ESP / DRY RUN'):'OFFLINE';$('connectionBadge').dataset.online=String(!!state.connected);$('mode').textContent=state.message;$('serverValues').textContent=`ESP requests: throttle ${Math.round(state.throttle*100)}% · steering ${Math.round(state.steering*100)}% · Motor output ${Math.round((state.drive_output||0)*100)}% / ${Math.round((state.steering_output||0)*100)}%`}
function labels(){
  for(const kind of ['accel','brake'])$(kind+'Calibration').textContent=`Raw released: ${mapping[kind+'Rest'].toFixed(3)} → 0.000 · Raw fully pressed: ${mapping[kind+'Full'].toFixed(3)} → 1.000`;
  $('steerCalibration').textContent=`Centre: ${mapping.steerCenter.toFixed(3)} · Left: ${mapping.steerLeft.toFixed(3)} · Right: ${mapping.steerRight.toFixed(3)}`;
}
function settingsUI(){
  $('source').value=mapping.inputSource;$('limit').value=Math.round(mapping.maxInput*100);$('limitValue').textContent=Math.round(mapping.maxInput*100)+'%';$('invertSteer').checked=mapping.invertSteer;$('brakeMode').value=mapping.brakeMode;$('brakeRumble').checked=mapping.brakeRumble;labels();
}
function save(){RCMapping.saveSettings(mapping);labels()}
for(const button of document.querySelectorAll('[data-setup-pedal]'))button.onclick=()=>{
  stop('Pedal setup: motor commands stopped. Finish setup, release inputs and press Arm.');session.reset();
  pedalSetup={kind:button.dataset.setupPedal,released:null,candidates:[]};
  $('pedalSetupTitle').textContent='Set up '+pedalNames[pedalSetup.kind];
  $('pedalSetupMessage').textContent='Release both pedals and keep the wheel centred. Click Save released.';
  $('pedalPressed').disabled=true;$('pedalApply').disabled=true;$('pedalCandidateLabel').hidden=true;
  $('pedalSetup').showModal();
};
$('pedalReleased').onclick=()=>{
  try{
    pedalSetup.released=RCMapping.pedalSnapshot(connected());pedalSetup.candidates=[];
    $('pedalPressed').disabled=false;$('pedalApply').disabled=true;$('pedalCandidateLabel').hidden=true;
    $('pedalSetupMessage').textContent='Now hold only the '+pedalNames[pedalSetup.kind]+' fully down and click Save fully pressed. Keep the wheel still.';
  }catch(error){$('pedalSetupMessage').textContent=error.message}
};
$('pedalPressed').onclick=()=>{
  try{
    $('pedalApply').disabled=true;$('pedalCandidateLabel').hidden=true;pedalSetup.candidates=[];
    pedalSetup.candidates=RCMapping.pedalCandidates(pedalSetup.released,connected(),[mapping.steerInput]);
    if(!pedalSetup.candidates.length)throw Error('No pedal movement detected. Release both pedals and start with Save released again, then press only this pedal fully. Button 0 and the steering input are excluded.');
    $('pedalCandidate').replaceChildren(...pedalSetup.candidates.map((candidate,i)=>new Option(`${candidate.binding.replace(':',' ')}: released ${candidate.rest.toFixed(3)} → pressed ${candidate.full.toFixed(3)}`,String(i))));
    $('pedalCandidateLabel').hidden=false;$('pedalApply').disabled=false;
    $('pedalSetupMessage').textContent=pedalSetup.candidates.length===1?'Pedal detected. Release it, then click Use this pedal to save.':'Several inputs changed. Choose the axis or button for this pedal, release it, then click Use this pedal.';
  }catch(error){$('pedalSetupMessage').textContent=error.message}
};
$('pedalApply').onclick=()=>{
  try{
    const pad=connected(),released=pedalSetup.released;
    if(!pad?.connected||!released||released.index!==pad.index||released.id!==pad.id||released.axes.length!==pad.axes.length||released.buttons.length!==pad.buttons.length)throw Error('Controller changed. Cancel and start pedal setup again.');
    const candidate=pedalSetup.candidates[+$('pedalCandidate').value];
    mapping=RCMapping.useDetectedPedal(mapping,pedalSetup.kind,candidate);save();session.reset();settingsUI();padSignature='';
    $('calibrationStatus').textContent=`Saved ${pedalNames[pedalSetup.kind]} on ${candidate.binding}: released = 0%, fully pressed = 100%.`;
    $('status').textContent='Pedal saved. Release pedals, centre steering, then press Arm or Button 0.';
    $('pedalSetup').close();
  }catch(error){$('pedalSetupMessage').textContent=error.message}
};
$('pedalCancel').onclick=()=>$('pedalSetup').close();
$('pedalSetup').addEventListener('close',()=>{pedalSetup=null});
function stop(message='Stopped / disarmed. Press Button 0 or Arm to resume.',force=false,pauseAuto=true){if(pauseAuto)pauseAutomatic(true);else autoArm.reset();return controlClient.stop({message,force})}
function reload(pauseAuto=false){stop(autoArm.paused?'Automatic arming paused. Press Button 0 or Arm to resume.':'Waiting for connection and neutral wheel/pedals to arm automatically.',false,pauseAuto);session.reset();mapping=RCMapping.loadSettings();padSignature='';settingsUI()}
$('stop').onclick=()=>stop('Emergency stop. Release inputs and press Arm to resume.',true);
for(const link of document.querySelectorAll('[data-disarm]'))link.addEventListener('click',()=>stop('Leaving the driving page; disarmed.'));
$('controllerTest').addEventListener('click',()=>stop('Controller test opened; disarmed.'));
async function armInputs(automatic=false){
  if($('pedalSetup').open)return;
  if(!automatic)pauseAutomatic(false);
  if(controlClient.armed||!active||document.hidden)return;
  if(controlClient.busy||controlClient.stopping){$('status').textContent='Connection check or stop is finishing. Release Button 0 and press it again to arm.';return}
  currentPad=connected();
  const wheel=mapping.inputSource==='wheel'||(mapping.inputSource==='auto'&&currentPad?.connected);
  if(wheel&&!currentPad){$('status').textContent='Connect and select the wheel first';return}
  if(wheel&&RCMapping.steeringCalibrationError(mapping)){$('status').textContent=RCMapping.steeringCalibrationError(mapping);return}
  if(wheel&&RCMapping.armBindingConflict(mapping)){$('status').textContent=RCMapping.armBindingConflict(mapping);return}
  const input=session.sample({pad:currentPad,mapping,keys,source:mapping.inputSource});
  if(wheel&&bindingIds.some(id=>mapping[id]!=='none'&&RCMapping.read(currentPad,mapping[id])===null)){$('status').textContent='Fix unavailable mappings before arming';return}
  if(input.stop){$('status').textContent='Release emergency stop before arming';return}
  if(Math.abs(input.throttle)>.05||Math.abs(input.steering)>.05||input.brake>.05){$('status').textContent='Release pedals and centre steering before arming';return}
  await controlClient.arm();
}
$('arm').onclick=()=>armInputs();
$('source').onchange=()=>{stop();session.reset();mapping.inputSource=$('source').value;save()};
$('pad').onchange=()=>{stop();session.reset();mapping.padIndex=+$('pad').value;save()};
$('limit').oninput=()=>{stop();mapping.maxInput=+$('limit').value/100;$('limitValue').textContent=$('limit').value+'%';save()};
$('invertSteer').onchange=()=>{stop();mapping.invertSteer=$('invertSteer').checked;save()};
$('brakeMode').onchange=()=>{stop();mapping.brakeMode=$('brakeMode').value;save()};
$('brakeRumble').onchange=()=>{mapping.brakeRumble=$('brakeRumble').checked;brakeRumble.cancel();save();$('brakeRumbleStatus').textContent=mapping.brakeRumble?'Brake burst enabled · 200 ms per press.':'Brake vibration off.'};
for(const id of bindingIds)$(id).onchange=()=>{
  stop();currentPad=connected();mapping[id]=$(id).value;
  if(id==='steerInput'){
    mapping=RCMapping.selectSteering(mapping,$(id).value);$('source').value=mapping.inputSource;session.reset();
    $('calibrationStatus').textContent=mapping.steerInput==='none'?'Choose the steering axis that moves in the controller test.':'Steering axis selected. Wheel input enabled; old steering calibration reset. Check the live raw value below.';
  }
  if(id==='accelInput'||id==='brakeInput'){
    const kind=id==='accelInput'?'accel':'brake',value=RCMapping.read(currentPad,mapping[id]);
    mapping[kind+'Rest']=value??0;mapping[kind+'Full']=mapping[id].startsWith('axis:')?(value>.5?-1:1):1;
    $('calibrationStatus').textContent='Set released and fully pressed for this pedal.';
  }save();
};
for(const button of document.querySelectorAll('[data-calibrate]'))button.onclick=()=>{
  stop();const key=button.dataset.calibrate,kind=key.startsWith('steer')?'steer':key.startsWith('accel')?'accel':'brake';
  // Gamepad snapshots may be immutable: read again at click time, not from the last animation frame.
  const freshPad=connected(),value=RCMapping.read(freshPad,mapping[kind+'Input']);
  try{
    if(value===null)throw Error('Select a detected input first');
    if(kind==='steer')mapping=RCMapping.captureSteering(mapping,key.slice(5),value);
    else mapping=RCMapping.capturePedal(mapping,kind,key.endsWith('Full')?'Full':'Rest',value);
    save();const message=kind==='steer'?'Saved '+button.textContent.toLowerCase()+' at '+value.toFixed(3):key.endsWith('Full')?`Fully pressed saved: raw ${value.toFixed(3)} maps to 1.000 (100%).`:`Released saved: raw ${value.toFixed(3)} maps to 0.000 (0%). Now hold the pedal fully down and click Set fully pressed.`;
    $('calibrationStatus').textContent=message;if(kind!=='steer')$(kind+'CaptureStatus').textContent=message;
  }catch(error){$('calibrationStatus').textContent=error.message;if(kind!=='steer')$(kind+'CaptureStatus').textContent=error.message}
};
$('resetMapping').onclick=()=>{stop();session.reset();mapping={...RCMapping.defaults};padSignature='';save();settingsUI()};
$('resetSteering').onclick=()=>{stop();session.reset();mapping=RCMapping.selectSteering(mapping,mapping.steerInput);save();settingsUI();$('calibrationStatus').textContent='Steering calibration reset. Turn the wheel and check its live raw value; then capture centre, full left and full right.'};
window.addEventListener('keydown',event=>{if(/INPUT|SELECT/.test(event.target.tagName))return;if(['KeyW','KeyS','KeyA','KeyD','Space'].includes(event.code)){event.preventDefault();if(event.code==='Space')stop('Keyboard emergency stop; disarmed.',true);else keys.add(event.code)}});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{active=false;stop('Driving page lost focus; stopped. Return with neutral inputs to resume.',false,false)});
window.addEventListener('focus',()=>{active=true;reload()});
window.addEventListener('pageshow',()=>{active=true;reload()});
window.addEventListener('storage',event=>{if(event.key===RCMapping.settingsKey||event.key===null)reload(true)});
document.addEventListener('visibilitychange',()=>{active=!document.hidden;if(active)reload();else stop('Driving page hidden; stopped.',false,false)});
window.addEventListener('pagehide',()=>{brakeRumble.cancel();controlClient.beaconStop()});
function connected(){
  const pads=Array.from(navigator.getGamepads?.()||[]).filter(p=>p?.connected),signature=pads.map(p=>p.index+':'+p.id+':'+p.axes.length+':'+p.buttons.length).join();
  if(signature!==$('pad').dataset.signature){$('pad').replaceChildren(...pads.map(p=>new Option(p.id,p.index)));if(pads.some(p=>p.index===mapping.padIndex))$('pad').value=String(mapping.padIndex);$('pad').dataset.signature=signature}
  return pads.find(p=>String(p.index)===$('pad').value)||null;
}
function populate(pad){
  const signature=pad?`${pad.index}:${pad.axes.length}:${pad.buttons.length}`:'none';if(signature===padSignature)return;padSignature=signature;
  for(const id of bindingIds){
    const options=[new Option('Not assigned','none')];
    if(id!=='stopInput'&&id!=='reverseInput')for(let i=0;i<(pad?.axes.length||0);i++)options.push(new Option('Axis '+i,'axis:'+i));
    for(let i=0;i<(pad?.buttons.length||0);i++){const option=new Option(i===0?'Button 0 (reserved for Arm)':'Button '+i,'button:'+i);option.disabled=i===0;options.push(option)}
    if(mapping[id]!=='none'&&!options.some(option=>option.value===mapping[id]))options.push(new Option(mapping[id]+' (unavailable)',mapping[id]));
    $(id).replaceChildren(...options);$(id).value=mapping[id];
  }labels();
}
function tick(){
  try{
    const previous=currentPad;currentPad=connected();
    if(previous&&(!currentPad||previous.index!==currentPad.index||previous.id!==currentPad.id))stop('Wheel disconnected or selected controller changed; stopped.',false,false);
    if(armed&&mapping.inputSource==='auto'&&!previous&&currentPad)stop('Wheel connected; waiting for neutral inputs.',false,false);
    populate(currentPad);$('padInfo').textContent=currentPad?`${currentPad.id} · ${currentPad.axes.length} axes · ${currentPad.buttons.length} buttons`:'Connect the wheel and press a button to detect it.';
    $('axes').textContent=currentPad?currentPad.axes.map((value,i)=>`Axis ${i}: ${value.toFixed(3)}`).join(' | '):'No axes detected';
    $('buttons').textContent=currentPad?currentPad.buttons.map((button,i)=>`Button ${i}: ${button.value.toFixed(3)}${button.pressed?' PRESSED':''}`).join(' | '):'No buttons detected';
    const steerRaw=RCMapping.read(currentPad,mapping.steerInput),steerValue=RCMapping.steering(steerRaw,mapping.steerCenter,mapping.steerLeft,mapping.steerRight,mapping.invertSteer);
    $('steerLive').textContent=steerRaw===null?'Selected steering input is unavailable. Select the wheel and the axis shown in the controller test.':`${mapping.steerInput} raw: ${steerRaw.toFixed(3)} · Calibrated: ${Math.round(steerValue*100)}% · Source: ${mapping.inputSource}`;
    $('steerMeter').value=steerValue;
    for(const kind of ['accel','brake']){
      const raw=RCMapping.read(currentPad,mapping[kind+'Input']),value=RCMapping.pedal(raw,mapping[kind+'Rest'],mapping[kind+'Full']);
      $(kind+'Live').textContent=raw===null?'Select a detected pedal input':`Raw now: ${raw.toFixed(3)} · Calibrated: ${value.toFixed(3)} (${Math.round(value*100)}%)`;
      $(kind+'Meter').value=value;
    }
    let input={throttle:0,steering:0,brake:0,reverse:false,usingWheel:false};
    if(active&&!document.hidden)input=session.sample({pad:currentPad,mapping,keys,source:mapping.inputSource});
    const missing=input.usingWheel?bindingIds.filter(id=>mapping[id]!=='none'&&RCMapping.read(currentPad,mapping[id])===null):[];
    $('pedalStatus').textContent=input.usingWheel?RCMapping.pedalStatus(currentPad,mapping):'Keyboard selected. Set up the accelerator to use wheel pedals.';
    $('inputError').textContent=missing.length?'Unavailable mapping: '+missing.join(', '):input.usingWheel?(RCMapping.steeringCalibrationError(mapping)||RCMapping.armBindingConflict(mapping)):'';
    if(input.stop&&(armed||!autoArm.paused))stop('Mapped emergency-stop button pressed; disarmed.',true);
    else if(armed&&input.reverseChanged)stop('Forward/reverse selection changed; centre inputs and re-arm.');
    else if(armed&&missing.length)stop('A mapped wheel input became unavailable; disarmed.');
    $('inputValues').textContent=`Throttle ${Math.round(input.throttle*100)}% · Steering ${Math.round(input.steering*100)}%`;
    $('direction').textContent=input.reverse?'Reverse selected':'Forward selected';
    renderDiagram(input);preview={throttle:input.throttle*mapping.maxInput,steering:input.steering};
    if(input.armPressed&&!input.stop&&!input.reverseChanged&&!$('pedalSetup').open){
      if(controlClient.armed||controlClient.arming)stop('Button 0: disarmed. Automatic arming paused until Button 0 or Arm is pressed again.');
      else if(autoArm.paused)armInputs();
      else stop('Button 0: automatic arming paused. Press again to resume.');
    }
    const armHeld=(RCMapping.read(currentPad,RCMapping.armBinding)??0)>.5;
    const neutral=Math.abs(input.throttle)<=.05&&Math.abs(input.steering)<=.05&&(input.brake||0)<=.05&&!input.stop;
    const valid=!$('pedalSetup').open&&input.usingWheel&&RCMapping.read(currentPad,RCMapping.armBinding)!==null&&!missing.length&&!RCMapping.steeringCalibrationError(mapping)&&!RCMapping.armBindingConflict(mapping);
    if(autoArm.ready({connected:espConnected,remoteArmed,active:active&&!document.hidden&&document.hasFocus(),wheelConnected:!!currentPad?.connected,valid,neutral,armHeld,armed:controlClient.armed,busy:controlClient.busy||!!controlClient.stopping},performance.now()))armInputs(true);
    $('autoArmStatus').textContent=autoArm.paused?'Auto-arm paused — Button 0 / Arm resumes':controlClient.armed?'Armed ? Button 0 disarms':remoteArmed?'Another controller is armed':!espConnected?'Waiting for ESP connection':!valid?'Waiting for wheel and valid calibration':!neutral||armHeld?'Centre wheel, release pedals and Button 0':'Auto-arm ready after 0.5 seconds at neutral';
    brakeRumble.update(currentPad,input.brake,mapping.brakeRumble&&input.usingWheel&&active&&!document.hidden);
  }catch(error){$('inputError').textContent=error.message;if(armed)stop()}
  requestAnimationFrame(tick);
}
function renderDiagram(input){
  const view=RCMapping.simulationState(input),scene=$('carScene');
  $('frontLeft').setAttribute('transform',`rotate(${view.angle} 70 120)`);
  $('frontRight').setAttribute('transform',`rotate(${view.angle} 270 120)`);
  scene.classList.toggle('moving',view.moving);scene.classList.toggle('reversing',view.throttle<0);scene.classList.toggle('braking',view.braking);
  scene.style.setProperty('--tread-duration',(.65-.55*Math.abs(view.throttle)).toFixed(3)+'s');
  $('motionState').textContent=view.state;
  $('forwardArrow').classList.toggle('active',view.throttle>.05);$('reverseArrow').classList.toggle('active',view.throttle<-.05);
  $('requestedSteering').textContent=Math.round(input.steering*100)+'%';$('requestedThrottle').textContent=Math.round(input.throttle*100)+'%';
}
settingsUI();requestAnimationFrame(tick);
