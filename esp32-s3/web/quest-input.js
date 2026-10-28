(function(root){
  'use strict';
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function axis(value){if(!Number.isFinite(value))throw Error('Invalid controller axis');return Math.abs(value)<=.12?0:Math.sign(value)*(clamp(Math.abs(value),0,1)-.12)/.88}
  function button(pad,index){const value=pad.buttons[index]?.value;if(!Number.isFinite(value)||value<0||value>1)throw Error('Missing or invalid Touch button');return value}
  class QuestInput{
    constructor(){this.lastFrame=-Infinity;this.visible=false;this.left=null;this.right=null;this.limit=1;this.invert=false;this.previousArm=true;this.previousStop=true}
    update(sources,now,tracked=()=>true){
      const profiles=['oculus-touch','oculus-touch-v2','oculus-touch-v3','meta-quest-touch-pro','meta-quest-touch-plus'];
      const controllers=[...sources].filter(source=>source.gamepad&&source.gamepad.connected!==false&&source.profiles?.some(profile=>profiles.includes(profile))&&source.targetRayMode==='tracked-pointer'&&tracked(source));
      const left=controllers.find(source=>source.handedness==='left'),right=controllers.find(source=>source.handedness==='right');
      if(!left||!right||left.gamepad.mapping!=='xr-standard'||right.gamepad.mapping!=='xr-standard'||left.gamepad.axes.length<4||right.gamepad.buttons.length<6)throw Error('Both tracked Touch controllers are required');
      const changed=!!this.left&&(this.left!==left||this.right!==right);
      this.left=left;this.right=right;this.lastFrame=now;
      const arm=button(right.gamepad,4)>.5,stop=button(right.gamepad,5)>.5;
      const edges={arm:arm&&!this.previousArm,stop:stop&&!this.previousStop,changed};
      this.previousArm=arm;this.previousStop=stop;
      return edges;
    }
    clear(){this.lastFrame=-Infinity;this.left=null;this.right=null;this.previousArm=true;this.previousStop=true}
    read(now,{videoFresh=false,requireGrip=true}={}){
      if(!this.visible||now-this.lastFrame>180||!this.left||!this.right)throw Error('VR tracking or controller data stopped; disarmed');
      if(!videoFresh)throw Error('Live video is missing or stale; disarmed');
      const forward=button(this.right.gamepad,0),reverse=button(this.left.gamepad,0);
      if(forward>.08&&reverse>.08)throw Error('Both triggers pressed; release and re-arm');
      const steering=axis(this.left.gamepad.axes[2])*(this.invert?-1:1);
      const throttle=(forward>.08?(forward-.08)/.92:reverse>.08?-(reverse-.08)/.92:0)*clamp(this.limit,.1,1);
      const grip=button(this.right.gamepad,1)>.5;
      return requireGrip&&!grip?{throttle:0,steering:0}:{throttle,steering};
    }
    neutral(now,videoFresh){const input=this.read(now,{videoFresh,requireGrip:false});return Math.abs(input.throttle)<=.05&&Math.abs(input.steering)<=.05}
  }
  if(typeof module!=='undefined')module.exports={QuestInput};else root.RCQuest={QuestInput};
})(globalThis);
