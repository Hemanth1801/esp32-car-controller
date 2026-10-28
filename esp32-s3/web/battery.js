(function(root){
  'use strict';
  // Charge must come from a battery sensor; supply voltage is not a charge estimate.
  function reading(state={}){
    if(!state.connected)return {status:'offline',value:'Unavailable',detail:'Waiting for the car connection.',percent:null};
    const battery=state.battery;
    if(!battery||battery.available===false||battery.fresh===false)return {status:'unavailable',value:'Unavailable',detail:'No battery reading from the ESP. A battery sensor must be connected and configured.',percent:null};
    const percent=typeof battery.percent==='number'&&Number.isFinite(battery.percent)&&battery.percent>=0&&battery.percent<=100?battery.percent:null;
    const voltage=typeof battery.voltage==='number'&&Number.isFinite(battery.voltage)&&battery.voltage>0?battery.voltage:null;
    if(percent===null&&voltage===null)return {status:'unavailable',value:'Unavailable',detail:'The ESP has not reported a valid battery reading.',percent:null};
    return {status:percent!==null&&percent<=20?'low':'ready',value:percent!==null?Math.round(percent)+'%':voltage.toFixed(2)+' V',detail:voltage!==null?(percent!==null?voltage.toFixed(2)+' V measured at the battery.':'Battery voltage only; charge percentage is unavailable.'):'Charge reported by the car battery sensor.',percent};
  }
  function render(element,state){
    if(!element)return;
    const view=reading(state);
    element.dataset.state=view.status;
    element.querySelector('[data-battery-value]').textContent=view.value;
    element.querySelector('[data-battery-detail]').textContent=view.detail;
    const meter=element.querySelector('meter');
    meter.hidden=view.percent===null;
    meter.value=view.percent??0;
  }
  if(typeof module!=='undefined')module.exports={reading,render};else root.RCBattery={reading,render};
})(globalThis);
