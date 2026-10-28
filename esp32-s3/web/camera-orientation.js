(function(root){
  'use strict';
  const key='espS3CarCameraOrientationV1';
  const modes={normal:[1,1],rotate180:[-1,-1],flipVertical:[1,-1],mirror:[-1,1]};
  // The currently mounted OV3660 is upside down. Keep the correction local to
  // this package; it must never rotate the cockpit, HUD or generated practice.
  function load(){try{const saved=root.localStorage.getItem(key);if(Object.hasOwn(modes,saved))return saved}catch{}return 'rotate180'}
  function save(mode){if(!Object.hasOwn(modes,mode))throw Error('Invalid camera orientation');try{root.localStorage.setItem(key,mode)}catch{}return mode}
  function flips(mode){return modes[mode]||modes.normal}
  function css(mode){const [x,y]=flips(mode);return `scale(${x}, ${y})`}
  function bind(select,onChange){select.value=load();select.addEventListener('change',()=>{save(select.value);onChange(select.value)});return select.value}
  root.RCCameraOrientation={load,save,flips,css,bind};
})(globalThis);
