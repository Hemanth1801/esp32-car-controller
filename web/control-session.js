(function(root){
  'use strict';
  function commandTimeoutText(state){
    return state.command_timeout_enabled===false?'Command timeout OFF in ESP firmware. Last motor output can persist if commands stop.':`ESP command timeout: ${state.command_timeout_ms||400} ms without valid control commands.`;
  }
  class ControlSession {
    constructor({getInput=()=>({throttle:0,steering:0}),onState=()=>{},onStatus=()=>{},onStop=()=>{},fetcher=(...args)=>fetch(...args),now=()=>Date.now(),autoStart=true}={}){
      Object.assign(this,{getInput,onState,onStatus,onStop,fetcher,now});
      this.owner=root.crypto.randomUUID();this.armed=false;this.arming=false;this.busy=false;this.stopping=null;this.epoch=0;this.lastStatus=-Infinity;this.seq=0;this.session='';this.lastState={};
      if(autoStart)this.timer=setInterval(()=>this.poll(),50);
    }
    async request(path,data){
      const options={signal:AbortSignal.timeout(700)};
      if(data!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,owner:this.owner})});
      const response=await this.fetcher(path,options),state=await response.json();
      if(!response.ok){const error=Error(state.error||'Control request failed');error.status=response.status;throw error}
      this.lastState=state;return state;
    }
    readInput(){try{return this.getInput()}catch(error){error.inputFault=true;throw error}}
    failureState(error){
      // Input expiry and rejected commands still stop control, but do not prove a Wi-Fi outage.
      const localFault=error.inputFault||error.status===400||error.status===409;
      // Local input/rejection errors need a connection check; network failures back off.
      this.lastStatus=localFault?-Infinity:this.now();
      return {...this.lastState,connected:localFault?!!this.lastState.connected:false,armed:false,throttle:0,steering:0,drive_output:0,steering_output:0,message:error.message};
    }
    reset(reason=''){const wasActive=this.armed||this.arming;this.epoch++;this.armed=false;this.session='';this.seq=0;this.onStop(reason,wasActive)}
    async stop({force=false,message='Stopped / disarmed'}={}){
      const ownsControl=this.armed||this.arming;
      this.reset(message);this.onStatus(message);
      if(this.stopping)return this.stopping;
      if(!ownsControl&&!force)return;
      this.stopping=(async()=>{
        try{const state=await this.request('/api/stop',{});if(!this.armed)this.onState({...state,armed:false})}
        catch(error){if(!this.armed){this.onState(this.failureState(error));this.onStatus(error.message)}}
        finally{this.stopping=null}
      })();
      return this.stopping;
    }
    async arm(){
      if(this.busy||this.stopping||this.armed)return false;
      const ticket=++this.epoch;this.busy=true;
      try{
        const input=this.readInput();
        if(Math.abs(input.throttle)>.05||Math.abs(input.steering)>.05)throw Error('Release pedals and centre steering before arming');
        this.arming=true;
        const state=await this.request('/api/arm',{...input,neutral:true});
        if(ticket!==this.epoch){await this.request('/api/stop',{});return false}
        if(!state.armed||!state.session)throw Error('ESP did not acknowledge arming');
        this.session=state.session;this.seq=0;this.armed=true;this.onState(state);this.onStatus('Inputs armed');return true;
      }catch(error){
        if(ticket===this.epoch){this.reset(error.message);this.onStatus(error.message)}
        return false;
      }finally{this.arming=false;this.busy=false}
    }
    async poll(){
      if(this.busy||this.stopping||(!this.armed&&this.now()-this.lastStatus<1000))return;
      this.busy=true;const ticket=this.epoch;
      try{
        let state;
        if(this.armed)state=await this.request('/api/control',{...this.readInput(),session:this.session,seq:++this.seq});
        else{this.lastStatus=this.now();state=await this.request('/api/status')}
        if(ticket!==this.epoch)return;
        if(this.armed&&!state.armed){this.reset('ESP stopped / disarmed');this.onStatus('ESP stopped / disarmed; press Arm to resume')}
        this.onState({...state,remoteArmed:state.armed,armed:this.armed});
      }catch(error){
        if(!this.armed&&error.status===409)return; // A concurrent stop is still finishing; never queue another request.
        if(ticket===this.epoch){const ownsControl=this.armed;this.reset(error.message);this.onState(this.failureState(error));this.onStatus(error.message);if(ownsControl)this.request('/api/stop',{}).catch(()=>{})}
      }finally{this.busy=false}
    }
    beaconStop(){const ownsControl=this.armed||this.arming;this.reset('Driving page closed; disarmed');if(ownsControl)root.navigator.sendBeacon('/api/stop',JSON.stringify({owner:this.owner}))}
    destroy(){clearInterval(this.timer);this.beaconStop()}
  }
  if(typeof module!=='undefined')module.exports={ControlSession,commandTimeoutText};else root.RCControls={ControlSession,commandTimeoutText};
})(globalThis);
