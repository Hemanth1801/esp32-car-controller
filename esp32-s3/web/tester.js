(function(root){
  function snapshot(pad){
    const axes=Array.from(pad?.axes||[],v=>Number.isFinite(v)?Math.min(1,Math.max(-1,v)):0);
    const buttons=Array.from(pad?.buttons||[],b=>({value:Number.isFinite(b.value)?Math.min(1,Math.max(0,b.value)):b.pressed?1:0,pressed:!!b.pressed}));
    return {connected:!!pad?.connected,name:pad?.id||'',axes,buttons};
  }
  if(typeof module!=='undefined'){module.exports={snapshot};return}
  const $=id=>document.getElementById(id);let player=0,lastSignature='',rumbling=false,trailPositions={};
  const fmt=v=>(v>=0?'+':'')+v.toFixed(2),number=(array,i)=>array[i]??0;
  async function disarm(){try{await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:'tester'}),signal:AbortSignal.timeout(1500)})}catch{}}
  disarm();
  for(const button of document.querySelectorAll('[data-player]'))button.onclick=()=>{player=+button.dataset.player;lastSignature='';disarm()};
  $('theme').onclick=()=>document.body.classList.toggle('light');
  $('clearTrails').onclick=()=>{for(const id of ['leftTrail','rightTrail'])$(id).replaceChildren();trailPositions={}};
  function rawNodes(state){
    const axisCount=state.connected?state.axes.length:4,buttonCount=state.connected?state.buttons.length:18;
    const signature=player+':'+state.connected+':'+axisCount+':'+buttonCount;
    if(signature===lastSignature)return;lastSignature=signature;
    $('rawAxes').replaceChildren();$('rawButtons').replaceChildren();
    for(let i=0;i<axisCount;i++){const row=document.createElement('div');row.className='raw-axis';row.innerHTML=`<b>${i}</b><div class="axis-track"><span class="axis-fill" id="axisFill${i}"></span></div><output id="axisValue${i}">+0.00</output>`;$('rawAxes').append(row)}
    for(let i=0;i<buttonCount;i++){const row=document.createElement('div');row.className='raw-button';row.id='rawButton'+i;row.innerHTML=`${i}<small id="buttonValue${i}">0.00</small>`;$('rawButtons').append(row)}
  }
  function render(){
    try{
      const pads=navigator.getGamepads?.()||[],pad=pads[player],state=snapshot(pad);rawNodes(state);
      for(const b of document.querySelectorAll('[data-player]')){b.classList.toggle('selected',+b.dataset.player===player);b.classList.toggle('connected',!!pads[+b.dataset.player]?.connected)}
      $('controllerName').textContent=state.connected?state.name:'Press a controller button to begin';
      $('connection').textContent=state.connected?`${state.axes.length} AXES · ${state.buttons.length} BUTTONS`:'NO CONTROLLER CONNECTED';$('connection').classList.toggle('connected',state.connected);
      for(const group of document.querySelectorAll('[data-button]')){const button=state.buttons[+group.dataset.button];group.classList.toggle('pressed',!!button&&(button.pressed||button.value>.1))}
      for(const [prefix,xIndex,yIndex,cx,cy] of [['left',0,1,130,180],['right',2,3,330,275]]){
        const x=number(state.axes,xIndex),y=number(state.axes,yIndex);$(prefix+'Dot').style.left=(50+x*44)+'%';$(prefix+'Dot').style.top=(50+y*44)+'%';$(prefix+'Value').textContent=fmt(x)+', '+fmt(y);$(prefix+'Offset').textContent=state.connected?'Offset: '+(Math.hypot(x,y)*100).toFixed(1)+'%':'Offset: —';$(prefix+'Thumb').setAttribute('cx',cx+x*8);$(prefix+'Thumb').setAttribute('cy',cy+y*8);
        const previous=trailPositions[prefix];if(state.connected&&(!previous||Math.hypot(x-previous[0],y-previous[1])>.025)){const dot=document.createElement('span');dot.style.left=(50+x*44)+'%';dot.style.top=(50+y*44)+'%';const trail=$(prefix+'Trail');trail.append(dot);if(trail.children.length>80)trail.firstElementChild.remove();trailPositions[prefix]=[x,y]}
      }
      for(const [prefix,index] of [['left',6],['right',7]]){const value=state.buttons[index]?.value||0;$(prefix+'TriggerFill').style.height=(value*100)+'%';$(prefix+'TriggerValue').textContent=value.toFixed(2)}
      const axisCount=state.connected?state.axes.length:4,buttonCount=state.connected?state.buttons.length:18;
      for(let i=0;i<axisCount;i++){const value=state.axes[i]||0;$('axisValue'+i).textContent=fmt(value);$('axisFill'+i).style.width=(Math.abs(value)*50)+'%';$('axisFill'+i).style.left=(value<0?50+value*50:50)+'%'}
      for(let i=0;i<buttonCount;i++){const value=state.buttons[i]?.value||0;$('rawButton'+i).classList.toggle('active',value>.05||!!state.buttons[i]?.pressed);$('buttonValue'+i).textContent=value.toFixed(2)}
      const support=!!(pad?.vibrationActuator?.playEffect||pad?.hapticActuators?.[0]?.pulse);
      for(const b of document.querySelectorAll('[data-rumble]'))b.disabled=!support||rumbling;
      if(!rumbling)$('rumbleStatus').textContent=!state.connected?'Connect a controller to check rumble support.':support?'Rumble available on this controller.':'This controller does not expose browser rumble.';
    }catch(e){$('connection').textContent=e.message}
    requestAnimationFrame(render);
  }
  for(const button of document.querySelectorAll('[data-rumble]'))button.onclick=async()=>{
    if(rumbling)return;rumbling=true;await disarm();const pad=navigator.getGamepads?.()[player];
    try{const kind=button.dataset.rumble,duration=kind==='burst'?200:kind==='pulse'?300:600,strongMagnitude=kind==='light'?0:.7,weakMagnitude=kind==='strong'?0:.7;
      if(pad?.vibrationActuator?.playEffect)await pad.vibrationActuator.playEffect('dual-rumble',{startDelay:0,duration,strongMagnitude,weakMagnitude});
      else if(pad?.hapticActuators?.[0]?.pulse)await pad.hapticActuators[0].pulse(.7,duration);
      else throw Error('Rumble is unavailable');
      $('rumbleStatus').textContent='Rumble test finished.';
    }catch(e){$('rumbleStatus').textContent=e.message}finally{rumbling=false}
  };
  requestAnimationFrame(render);
})(globalThis);
