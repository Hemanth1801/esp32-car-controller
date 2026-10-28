'use strict';
const assert=require('node:assert/strict');
const {AutoArmPolicy}=require('../web/auto-arm.js');
const good={connected:true,remoteArmed:false,active:true,wheelConnected:true,valid:true,neutral:true,armHeld:false,armed:false,busy:false};
const policy=new AutoArmPolicy();
assert.equal(policy.ready(good,0),false);assert.equal(policy.ready(good,499),false);
assert.equal(policy.ready(good,500),true,'Default arms after stable neutral and connection');
assert.equal(policy.ready(good,501),false,'No request storm while awaiting arm result');
assert.equal(policy.ready(good,2499),false);assert.equal(policy.ready(good,2500),true,'Failed attempts back off');
policy.pause();assert.equal(policy.ready(good,10000),false,'Button stop remains latched');
assert.equal(policy.ready({...good,connected:false},10100),false);
assert.equal(policy.ready(good,11000),false,'Reconnect cannot override manual disarm');
policy.pause(false);assert.equal(policy.ready(good,12000),false);assert.equal(policy.ready(good,12500),true);
for(const bad of [{connected:false},{remoteArmed:true},{active:false},{wheelConnected:false},{valid:false},{neutral:false},{armHeld:true},{armed:true}]){
  const candidate=new AutoArmPolicy();candidate.ready(good,0);
  assert.equal(candidate.ready({...good,...bad},500),false);
  assert.equal(candidate.ready(good,501),false,'A fresh neutral interval is required after an interruption');
  assert.equal(candidate.ready(good,1001),true);
}
const busy=new AutoArmPolicy();busy.ready(good,0);assert.equal(busy.ready({...good,busy:true},500),false);assert.equal(busy.ready(good,501),true);
console.log('Auto-arm passed: neutral dwell, ownership, button pause latch, reconnect, fault gates and retry backoff.');
