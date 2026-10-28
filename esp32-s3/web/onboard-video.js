'use strict';
// A preview only: never arms or sends motor requests.
(() => {
  const image = document.getElementById('onboardVideo');
  const status = document.getElementById('onboardVideoStatus');
  const orientation = document.getElementById('cameraOrientation');
  function orient(mode){image.style.transform=RCCameraOrientation.css(mode)}
  orient(RCCameraOrientation.bind(orientation,mode=>{stop('Camera orientation changed. Press Arm to resume.');orient(mode)}));
  let currentUrl = '', sequence = '', lastFrame = -Infinity;
  async function tick() {
    if (!document.hidden) {
      const began = performance.now();
      try {
        const response = await fetch('/api/video/frame', {cache:'no-store', signal:AbortSignal.timeout(600)});
        if (!response.ok) throw Error('Camera unavailable');
        const next = response.headers.get('X-Frame-Sequence');
        const age = Number(response.headers.get('X-Frame-Age-Ms'));
        if (!Number.isFinite(age) || age < 0 || age > 750) throw Error('Camera frame stale');
        if (next !== sequence) {
          const url = URL.createObjectURL(await response.blob());
          const previous = currentUrl;
          currentUrl = url; image.src = url; sequence = next;
          if (previous) URL.revokeObjectURL(previous);
          lastFrame = began - age;
        }
        if (performance.now() - lastFrame > 750) throw Error('Camera frame stale');
        image.hidden = false; status.textContent = 'LIVE CAMERA · delivery age ' + Math.round(performance.now() - lastFrame) + ' ms';
      } catch {
        if (performance.now() - lastFrame > 750) {
          image.hidden = true;
          status.textContent = image.dataset.cameraError || 'Waiting for camera. Desktop controls remain available.';
        }
      }
    } else {
      image.hidden = true;
    }
    setTimeout(tick, 100);
  }
  tick();
})();
