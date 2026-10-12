/* Progressive enhancement: both sides and every letter work without JavaScript. */
(() => {
  const side = document.documentElement.dataset.side;
  if (!side) return;
  const prefix = 'dionysus-edition:';
  const storage = {
    get(key) { try { return JSON.parse(sessionStorage.getItem(prefix + key)); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(prefix + key, JSON.stringify(value)); } catch { /* Navigation still works. */ } },
    remove(key) { try { sessionStorage.removeItem(prefix + key); } catch { /* Private mode. */ } },
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pending = storage.get('flip');
  const arriving = pending && pending.side === side && Date.now() - pending.time < 10000;
  if (arriving && !reduced()) document.documentElement.classList.add('side-enter');
  if (arriving) storage.remove('flip');

  addEventListener('DOMContentLoaded', () => {
    const copyButton = document.querySelector('.copy-markdown');
    const markdownSource = document.getElementById('side-b-markdown');
    if (copyButton && markdownSource) {
      const markdown = JSON.parse(markdownSource.textContent);
      const label = copyButton.querySelector('.copy-label');
      let resetLabel;
      copyButton.parentElement.hidden = false;
      copyButton.addEventListener('click', async () => {
        clearTimeout(resetLabel);
        copyButton.disabled = true;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(markdown);
          } else {
            const textarea = document.createElement('textarea');
            textarea.value = markdown;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(textarea);
            try {
              textarea.select();
              if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
            } finally {
              textarea.remove();
            }
          }
          label.textContent = 'Copied!';
        } catch {
          label.textContent = 'Try again';
        } finally {
          copyButton.disabled = false;
          copyButton.focus({ preventScroll: true });
          resetLabel = setTimeout(() => { label.textContent = 'Copy as Markdown'; }, 1800);
        }
      });
    }
    const cover = document.querySelector('.edition-cover');
    const bar = document.querySelector('.edition-bar');
    const header = document.querySelector('.page-header');
    let leaving = false;
    let restoring = Boolean(arriving);
    const save = () => {
      if (!restoring) storage.set(`position:${side}`, { y: scrollY });
    };
    addEventListener('pagehide', save);
    document.addEventListener('click', event => {
      const link = event.target.closest('a[data-flip]');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
      if (leaving) { event.preventDefault(); return; }
      event.preventDefault();
      save();
      leaving = true;
      storage.set('flip', { side: link.dataset.flip, time: Date.now() });
      const go = () => location.assign(link.href);
      const visible = cover && cover.getBoundingClientRect().bottom > 0 && cover.getBoundingClientRect().top < innerHeight;
      if (reduced() || !visible) { go(); return; }
      document.documentElement.classList.add('side-leave');
      setTimeout(go, 240);
    });
    if (bar && header) {
      const observer = new IntersectionObserver(([entry]) => {
        bar.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0;
      });
      observer.observe(header);
    }
    const restore = () => {
      if (arriving && !location.hash) {
        const saved = storage.get(`position:${side}`);
        if (saved && Number.isFinite(saved.y)) scrollTo({ top: saved.y, behavior: 'instant' });
      }
      restoring = false;
      setTimeout(() => document.documentElement.classList.remove('side-enter'), 300);
    };
    // Side A's cover reserves its height; waiting for load also handles restored MathJax layout.
    if (document.readyState === 'complete') restore();
    else addEventListener('load', restore, { once: true });
    addEventListener('pageshow', event => {
      if (event.persisted) {
        leaving = false;
        restoring = false;
        document.documentElement.classList.remove('side-leave', 'side-enter');
      }
    });
  });
})();
