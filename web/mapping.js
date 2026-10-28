(function(root){
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  const settingsKey='espCarMappingV2';
  const armBinding='button:0';
  const defaults=Object.freeze({steerInput:'axis:0',steerCenter:0,steerLeft:-1,steerRight:1,invertSteer:false,accelInput:'none',accelRest:0,accelFull:1,brakeInput:'none',brakeRest:0,brakeFull:1,brakeMode:'brake',brakeRumble:true,stopInput:'none',reverseInput:'none',maxInput:1,inputSource:'auto',padIndex:0});
  function loadSettings(storage=root.localStorage){
    let stored={},current=null;try{current=storage?.getItem(settingsKey);stored=JSON.parse(current||storage?.getItem('espCarMappingV1')||'{}')||{};if(!current)stored.maxInput=1}catch{}
    const result={...defaults};
    for(const key of Object.keys(defaults)){
      const value=stored[key];
      if(typeof value===typeof defaults[key]&&(typeof value!=='number'||Number.isFinite(value)))result[key]=value;
    }
    for(const key of ['steerInput','accelInput','brakeInput','stopInput','reverseInput'])if(!/^(none|axis:\d+|button:\d+)$/.test(result[key]))result[key]=defaults[key];
    if(!['brake','reverse'].includes(result.brakeMode))result.brakeMode='brake';
    if(!['auto','wheel','keyboard'].includes(result.inputSource))result.inputSource='auto';
    result.maxInput=clamp(result.maxInput,.1,1);
    if(!current)saveSettings(result,storage);
    return result;
  }
  function saveSettings(settings,storage=root.localStorage){try{storage?.setItem(settingsKey,JSON.stringify(settings))}catch{}}
  function read(pad,binding){
    if(!pad||!binding||binding==='none')return null;
    const [kind,index]=binding.split(':');let v;
    if(kind==='axis')v=pad.axes?.[Number(index)];
    if(kind==='button')v=pad.buttons?.[Number(index)]?.value;
    return Number.isFinite(v)?v:null;
  }
  function pedal(value,rest,full){
    if(value===null||!Number.isFinite(rest)||!Number.isFinite(full)||Math.abs(full-rest)<0.05)return 0;
    const amount=clamp((value-rest)/(full-rest),0,1);
    return amount<0.05?0:amount;
  }
  function capturePedal(mapping,kind,endpoint,value){
    if(!['accel','brake'].includes(kind)||!['Rest','Full'].includes(endpoint))throw Error('Invalid pedal calibration');
    if(!Number.isFinite(value))throw Error('Select the axis or button that changes when you press this pedal.');
    if(endpoint==='Full'&&Math.abs(value-mapping[kind+'Rest'])<.05)throw Error('No pedal travel detected. Set released with your foot off, then hold the pedal fully down and try again.');
    return {...mapping,[kind+endpoint]:value};
  }
  function pedalSnapshot(pad){
    if(!pad?.connected)throw Error('Connect and select the wheel first.');
    return {index:pad.index,id:pad.id,connected:true,axes:Array.from(pad.axes||[]),buttons:Array.from(pad.buttons||[],button=>({value:button.value}))};
  }
  function pedalCandidates(released,pad,excluded=[]){
    if(!released||!pad?.connected||released.index!==pad.index||released.id!==pad.id||released.axes.length!==pad.axes.length||released.buttons.length!==pad.buttons.length)throw Error('Controller changed. Start pedal setup again.');
    const candidates=[];
    for(const kind of ['axis','button']){
      const values=kind==='axis'?pad.axes:pad.buttons;
      for(let i=0;i<values.length;i++){
        const binding=kind+':'+i;
        if(binding===armBinding||excluded.includes(binding))continue;
        const rest=read(released,binding),full=read(pad,binding);
        if(rest!==null&&full!==null&&Math.abs(full-rest)>=.05)candidates.push({binding,rest,full,travel:Math.abs(full-rest)});
      }
    }
    return candidates.sort((a,b)=>b.travel-a.travel);
  }
  function useDetectedPedal(mapping,kind,candidate){
    if(!candidate||candidate.binding===armBinding||!/^(axis|button):\d+$/.test(candidate.binding))throw Error('Choose a detected pedal input.');
    let result=capturePedal(mapping,kind,'Rest',candidate.rest);
    result=capturePedal(result,kind,'Full',candidate.full);
    return {...result,[kind+'Input']:candidate.binding,inputSource:'wheel'};
  }
  function pedalStatus(pad,mapping){
    if(!pad?.connected)return 'Connect the wheel and press a controller button to detect it.';
    if(mapping.accelInput==='none')return 'Accelerator is not assigned. Use Set up accelerator below.';
    if(read(pad,mapping.accelInput)===null)return 'Accelerator input is unavailable. Use Set up accelerator again.';
    if(Math.abs(mapping.accelFull-mapping.accelRest)<.05)return 'Accelerator calibration has no travel. Use Set up accelerator again.';
    const accel=pedal(read(pad,mapping.accelInput),mapping.accelRest,mapping.accelFull);
    const brake=pedal(read(pad,mapping.brakeInput),mapping.brakeRest,mapping.brakeFull);
    if(mapping.brakeMode==='brake'&&brake>=.95)return 'Brake reads fully pressed and cancels throttle. If released, use Set up brake to recalibrate it.';
    return `Accelerator ${Math.round(accel*100)}% · ${mapping.brakeMode==='reverse'?'Reverse pedal':'Brake'} ${Math.round(brake*100)}%. Release both pedals before arming.`;
  }
  function selectSteering(mapping,binding){
    return {...mapping,steerInput:binding,steerCenter:0,steerLeft:-1,steerRight:1,inputSource:binding==='none'?mapping.inputSource:'wheel'};
  }
  function steeringCalibrationError(mapping){
    if(mapping.steerInput==='none')return 'Select the steering axis that moves in the controller test.';
    const {steerCenter:center,steerLeft:left,steerRight:right}=mapping;
    if(![center,left,right].every(Number.isFinite)||Math.abs(left-center)<.01||Math.abs(right-center)<.01||(left-center)*(right-center)>=0)return 'Steering calibration has no usable travel. Reset steering calibration, then capture centre, full left and full right.';
    return '';
  }
  function captureSteering(mapping,endpoint,value){
    if(!['Center','Left','Right'].includes(endpoint)||!Number.isFinite(value))throw Error('Select a detected steering axis first.');
    if(endpoint!=='Center'&&Math.abs(value-mapping.steerCenter)<.01)throw Error('No steering travel detected. Turn the wheel fully to that side before saving.');
    return {...mapping,['steer'+endpoint]:value};
  }
  function steering(value,center,left,right,invert){
    if(value===null||![value,center,left,right].every(Number.isFinite))return 0;
    const delta=value-center;
    const towardLeft=(value-center)*(left-center)>0;
    const span=(towardLeft?left:right)-center;
    if(Math.abs(span)<.01)return 0;
    let result=clamp(Math.abs(delta/span),0,1)*(towardLeft?-1:1);
    if(Math.abs(result)<.05)return 0;
    return invert?-result:result;
  }
  function wheel(pad,mapping,reverse){
    const steer=steering(read(pad,mapping.steerInput),mapping.steerCenter,mapping.steerLeft,mapping.steerRight,mapping.invertSteer);
    const accel=pedal(read(pad,mapping.accelInput),mapping.accelRest,mapping.accelFull);
    const brake=pedal(read(pad,mapping.brakeInput),mapping.brakeRest,mapping.brakeFull);
    let throttle=mapping.brakeMode==='reverse'?accel-brake:accel*(1-brake);
    if(reverse)throttle=-throttle;
    return {throttle:clamp(throttle,-1,1),steering:steer};
  }
  function armBindingConflict(mapping){
    const names={steerInput:'Steering',accelInput:'Accelerator',brakeInput:'Brake / reverse pedal',stopInput:'Emergency stop',reverseInput:'Forward / reverse toggle'};
    const conflicts=Object.keys(names).filter(key=>mapping[key]===armBinding);
    return conflicts.length?'Button 0 is reserved for Arm. Choose another input for: '+conflicts.map(key=>names[key]).join(', '):'';
  }
  class InputSession {
    constructor(){this.reset()}
    reset(){this.reverse=false;this.previousReverse=false;this.previousStop=false;this.previousArm=null;this.identity=null}
    sample({pad,mapping,keys=new Set(),source='wheel'}){
      const usingWheel=source==='wheel'||(source==='auto'&&!!pad?.connected);
      const identity=usingWheel&&pad?.connected?pad.index+':'+pad.id:null;
      if(identity!==this.identity){this.reset();this.identity=identity}
      let output,stop=false,reverseChanged=false,brake=0,armPressed=false;
      if(usingWheel){
        if(!pad?.connected)return {throttle:0,steering:0,brake:0,braking:false,reverse:false,stop:false,reverseChanged:false,armPressed:false,usingWheel:true};
        const armValue=read(pad,armBinding),armHeld=armValue===null?null:armValue>.5;
        armPressed=this.previousArm===false&&armHeld===true;
        this.previousArm=armHeld;
        const stopHeld=(read(pad,mapping.stopInput)??0)>.5;
        stop=stopHeld;
        const reverseHeld=(read(pad,mapping.reverseInput)??0)>.5;
        if(reverseHeld&&!this.previousReverse){this.reverse=!this.reverse;reverseChanged=true}
        this.previousReverse=reverseHeld;this.previousStop=stopHeld;
        output=wheel(pad,mapping,this.reverse);
        brake=mapping.brakeMode==='brake'?pedal(read(pad,mapping.brakeInput),mapping.brakeRest,mapping.brakeFull):0;
      }else{
        brake=keys.has('Space')?1:0;
        output={throttle:brake?0:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),steering:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)};
      }
      if(stop)output={throttle:0,steering:0};
      return {...output,brake,braking:brake>.05,reverse:this.reverse,stop,reverseChanged,armPressed,usingWheel};
    }
  }
  function simulationState(input){
    const throttle=input.stop?0:input.throttle;
    return {state:input.braking?'Braking':Math.abs(throttle)<.05?'Stopped':throttle>0?'Forward':'Reverse',angle:clamp(input.steering,-1,1)*30,throttle,steering:input.steering,brake:input.brake,braking:input.braking,moving:Math.abs(throttle)>=.05};
  }
  class BrakeRumble {
    constructor(report=()=>{}){this.report=report;this.held=false;this.pad=null;this.active=false;this.generation=0;this.busy=false}
    cancel(){
      this.generation++;this.busy=false;this.held=false;
      const actuator=this.pad?.vibrationActuator||this.pad?.hapticActuators?.[0];
      if(this.active&&actuator?.reset){try{Promise.resolve(actuator.reset()).catch(()=>{})}catch{}}
      this.active=false;
    }
    update(pad,brake,enabled=true){
      if(!enabled||!pad?.connected){this.cancel();this.pad=null;return}
      if(this.pad&&(this.pad.index!==pad.index||this.pad.id!==pad.id))this.cancel();
      this.pad=pad;
      if(brake<.05){this.held=false;return}
      if(brake<.12||this.held)return;
      this.held=true;
      if(this.busy)return;
      const actuator=pad.vibrationActuator||pad.hapticActuators?.[0];
      if(!actuator){this.report('This controller does not expose browser vibration.');return}
      const generation=++this.generation;
      this.busy=true;this.active=true;
      const complete=message=>{if(this.generation===generation){this.busy=false;this.active=false;this.report(message)}};
      try{
        let effect;
        if(actuator.playEffect)effect=actuator.playEffect('dual-rumble',{startDelay:0,duration:200,strongMagnitude:.85,weakMagnitude:.65});
        else if(actuator.pulse)effect=actuator.pulse(.85,200);
        else{complete('This controller does not expose browser vibration.');return}
        Promise.resolve(effect).then(()=>complete('Brake burst enabled · 200 ms per press.'),()=>complete('Vibration unavailable on this wheel/browser; driving inputs still work.'));
      }catch{complete('Vibration unavailable on this wheel/browser; driving inputs still work.')}
    }
  }
  const api={read,pedal,capturePedal,pedalSnapshot,pedalCandidates,useDetectedPedal,pedalStatus,selectSteering,steeringCalibrationError,captureSteering,steering,wheel,armBinding,armBindingConflict,BrakeRumble,defaults,settingsKey,loadSettings,saveSettings,InputSession,simulationState};
  if(typeof module!=='undefined')module.exports=api;else root.RCMapping=api;
})(globalThis);
