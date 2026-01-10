(() => {
  const rotator = document.querySelector('[data-rotator]');
  if (!rotator) return;

  const items = Array.from(rotator.querySelectorAll('.praise-rotator-item'));
  if (items.length === 0) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const intervalMs = Number.parseInt(rotator.dataset.interval || '9000', 10);
  let activeIndex = 0;
  let timer = null;

  const setActive = (index) => {
    items.forEach((item, itemIndex) => {
      item.classList.toggle('is-active', itemIndex === index);
    });
  };

  const updateMinHeight = () => {
    const heights = items.map((item) => item.offsetHeight);
    const maxHeight = Math.max(...heights);
    if (Number.isFinite(maxHeight) && maxHeight > 0) {
      rotator.style.minHeight = `${maxHeight}px`;
    }
  };

  const stop = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const start = () => {
    stop();
    if (items.length < 2 || prefersReducedMotion.matches) return;
    timer = window.setInterval(() => {
      activeIndex = (activeIndex + 1) % items.length;
      setActive(activeIndex);
    }, Number.isFinite(intervalMs) ? intervalMs : 9000);
  };

  const handleVisibility = () => {
    if (document.hidden) {
      stop();
      return;
    }
    start();
  };

  rotator.dataset.rotatorReady = 'true';
  setActive(activeIndex);
  updateMinHeight();
  start();

  window.addEventListener('resize', updateMinHeight);
  document.addEventListener('visibilitychange', handleVisibility);

  if (typeof prefersReducedMotion.addEventListener === 'function') {
    prefersReducedMotion.addEventListener('change', start);
  } else if (typeof prefersReducedMotion.addListener === 'function') {
    prefersReducedMotion.addListener(start);
  }
})();
