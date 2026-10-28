(function(root){
  'use strict';
  class AutoArmPolicy {
    constructor({paused=false,stableMs=500,retryMs=2000}={}){this.paused=paused;this.stableMs=stableMs;this.retryMs=retryMs;this.reset()}
    reset(){this.neutralSince=null;this.nextTryAt=0}
    pause(value=true){this.paused=value;this.reset()}
    ready(state,now){
      const eligible=!this.paused&&state.connected&&!state.remoteArmed&&state.active&&state.wheelConnected&&state.valid&&state.neutral&&!state.armHeld&&!state.armed;
      if(!eligible){this.neutralSince=null;return false}
      if(this.neutralSince===null)this.neutralSince=now;
      if(state.busy||now-this.neutralSince<this.stableMs||now<this.nextTryAt)return false;
      this.nextTryAt=now+this.retryMs;return true;
    }
  }
  if(typeof module!=='undefined')module.exports={AutoArmPolicy};else root.RCAutoArm={AutoArmPolicy};
})(globalThis);
