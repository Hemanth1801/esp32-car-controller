(function(root){
  'use strict';
  const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
  const settingsKey='espPhoneSettingsV2';
  function loadSettings(storage=root.localStorage){
    let result={limit:1,invert:false};
    try{
      const current=storage?.getItem(settingsKey),saved=JSON.parse(current||storage?.getItem('espPhoneSettingsV1')||'{}');
      result={limit:current?clamp(Number(saved.limit)||1,.1,1):1,invert:!!saved.invert};
      if(!current)storage?.setItem(settingsKey,JSON.stringify(result));
    }catch{}
    return result;
  }
  class PhoneInput {
    constructor(){this.enabled=false;this.calibrated=false;this.tilt=0;this.centre=0;this.lastAt=-Infinity;this.angle=null;this.filtered=null;this.pointers=new Map();this.invert=false;this.limit=1}
    clear(){this.pointers.clear()}
    rotate(){this.clear();this.calibrated=false;this.filtered=null;this.angle=null;this.lastAt=-Infinity}
    gravity(value,angle,now){
      if(!this.enabled||![value?.x,value?.y,value?.z,angle,now].every(Number.isFinite))return false;
      const length=Math.hypot(value.x,value.y,value.z);
      if(length<3||length>20)return false;
      angle=((angle%360)+360)%360;
      if(this.angle!==null&&this.angle!==angle)this.rotate();
      this.angle=angle;
      const radians=angle*Math.PI/180,lateral=value.x*Math.cos(radians)+value.y*Math.sin(radians);
      const raw=Math.asin(clamp(-lateral/length,-1,1))*180/Math.PI;
      this.filtered=this.filtered===null?raw:this.filtered+.25*(raw-this.filtered);
      this.tilt=this.filtered;this.lastAt=now;return true;
    }
    orientation(beta,gamma,angle,now){
      if(![beta,gamma].every(Number.isFinite))return false;
      const b=beta*Math.PI/180,g=gamma*Math.PI/180;
      return this.gravity({x:-9.81*Math.cos(b)*Math.sin(g),y:9.81*Math.sin(b),z:9.81*Math.cos(b)*Math.cos(g)},angle,now);
    }
    fresh(now){return this.enabled&&now-this.lastAt<=350}
    armIssue(now,{active=true,connected=true,otherController=false}={}){
      if(!active)return 'Return to this phone page before arming.';
      if(!this.enabled)return 'Tap Enable tilt and allow motion access first.';
      if(!this.fresh(now))return 'Waiting for fresh tilt data. Move the phone gently, then hold it at centre.';
      if(!this.calibrated)return 'Hold the phone comfortably and tap Set centre first.';
      if(this.pointers.size)return 'Release both drive buttons before arming.';
      if(Math.abs(this.steering())>.05)return 'Hold the phone at its saved centre, or tap Set centre again, before arming.';
      if(!connected)return 'Waiting for the ESP connection. Check the connection indicator and try Arm again.';
      if(otherController)return 'Another controller is armed. Disarm the computer wheel with Button 0 and leave its page before arming here.';
      return '';
    }
    calibrate(now){if(!this.fresh(now))return false;this.clear();this.centre=this.tilt;this.calibrated=true;return true}
    steering(){const delta=this.tilt-this.centre,amount=clamp((Math.abs(delta)-3)/27,0,1);return Math.sign(delta)*amount*(this.invert?-1:1)}
    press(id,direction){
      this.pointers.set(id,direction);
      if(new Set(this.pointers.values()).size>1){this.clear();return false}
      return true;
    }
    release(id){this.pointers.delete(id)}
    sample(now){
      if(!this.fresh(now)||!this.calibrated)throw Error('Tilt data unavailable. Enable tilt and set centre again.');
      const directions=new Set(this.pointers.values());
      const direction=directions.size===1?[...directions][0]:0;
      return {throttle:direction*this.limit,steering:direction?this.steering():0};
    }
  }
  const api={PhoneInput,loadSettings,settingsKey};
  if(typeof module!=='undefined')module.exports=api;else root.RCPhone=api;
})(globalThis);
