(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('ha_auto') !== '1' || parent === window) return;
  let parentOrigin;
  try {
    const target = new URL(params.get('ha_parent') || document.referrer);
    if (!['http:', 'https:'].includes(target.protocol)) return;
    parentOrigin = target.origin;
  } catch { return; }
  document.documentElement.classList.add('ha-auto-height');
  const panel = document.querySelector('main.panel');
  if (!panel) return;
  let pending = false, previous = 0;
  const report = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const height = Math.ceil(panel.getBoundingClientRect().height + 12);
      if (height === previous) return;
      previous = height;
      parent.postMessage({type: 'home-info-tile-height', channel: params.get('ha_channel'), height}, parentOrigin);
    });
  };
  new ResizeObserver(report).observe(panel);
  window.addEventListener('load', report);
  document.fonts?.ready.then(report);
  report();
})();
