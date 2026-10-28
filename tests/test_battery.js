'use strict';
const assert=require('node:assert/strict');
const {reading,render}=require('../web/battery.js');
const state=battery=>({connected:true,battery});
assert.equal(reading(state({percent:0})).value,'0%');
assert.equal(reading(state({percent:0})).status,'low');
assert.equal(reading(state({percent:100,voltage:4.2})).value,'100%');
assert.match(reading(state({percent:50,voltage:3.82})).detail,/3.82 V/);
assert.equal(reading(state({voltage:5})).value,'5.00 V');
assert.match(reading(state({voltage:5})).detail,/percentage is unavailable/);
assert.equal(reading({connected:false,battery:{percent:85}}).status,'offline','Disconnect must hide previous charge');
assert.equal(reading(state({available:false,percent:85})).status,'unavailable');
assert.equal(reading(state({fresh:false,percent:85})).status,'unavailable');
for(const battery of [undefined,{}, {percent:null},{percent:'80'},{percent:-1},{percent:101},{percent:NaN},{percent:Infinity},{voltage:0},{voltage:-2},{voltage:'5'}]){
  assert.equal(reading(state(battery)).value,'Unavailable','Invalid or absent readings must never become a charge percentage');
}
const parts={'[data-battery-value]':{},'[data-battery-detail]':{},meter:{}};
const element={dataset:{},querySelector:selector=>parts[selector]};
render(element,state({percent:45}));
assert.equal(parts.meter.hidden,false);assert.equal(parts.meter.value,45);
render(element,{connected:false,battery:{percent:45}});
assert.equal(parts.meter.hidden,true);assert.equal(parts.meter.value,0);
assert.equal(parts['[data-battery-value]'].textContent,'Unavailable');
render(null,{});
console.log('Battery display passed: charge, voltage-only, missing/invalid data, stale readings and disconnect.');
