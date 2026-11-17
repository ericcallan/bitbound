import { useEffect, useState } from 'react';
import { loadState, onLoadChange } from '../game/render/loadProgress';
import { useUI } from './store';

/** Longest the title waits behind the loader; after this it appears and the rest streams in behind it. */
const CAP_MS = 15000;

const LABELS = {
  download: 'Downloading the world',
  unfold: 'Unfolding the world',
  warm: 'Installing six generations',
  done: 'Ready',
};

/**
 * Drives the loader that index.html puts on screen at the first paint (#boot): real progress while the title's
 * models, textures and skies download, then the warm-up (src/game/render/warmup.ts). It fades out when the
 * title is complete, so its first frame is the finished scene. Art & Design and dev scenarios don't wait for
 * the title's world: the loader leaves as soon as they are mounted.
 */
export function Loader() {
  const screen = useUI((s) => s.screen);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const boot = document.getElementById('boot');
    if (!boot || gone) return;
    const fill = boot.querySelector<HTMLElement>('.boot__fill');
    const label = boot.querySelector<HTMLElement>('.boot__label');
    const retry = boot.querySelector<HTMLElement>('.boot__retry');
    const start = performance.now();
    document.body.classList.add('is-loading');
    let timer = 0;
    const hide = () => {
      boot.classList.add('boot--out');
      document.body.classList.remove('is-loading');
      setGone(true);
    };
    const paint = () => {
      const s = loadState();
      if (fill) fill.style.width = `${Math.max(4, Math.round(s.fraction * 100))}%`;
      if (label) {
        const mb = (b: number) => (b / 1e6).toFixed(1);
        label.textContent = s.phase === 'download' && s.totalBytes > 0 ? `${LABELS.download} · ${mb(s.bytes)} / ${mb(s.totalBytes)} MB` : LABELS[s.phase];
      }
      if (retry) retry.style.display = failed ? 'block' : 'none';
      // the title waits for its world; Art & Design for its page to arrive; anything else (dev scenarios) not at all
      const pageReady = screen === 'gallery' ? !!document.querySelector('.gallery') : screen !== 'menu';
      if (pageReady || s.phase === 'done' || performance.now() - start > CAP_MS) hide();
    };
    paint();
    const off = onLoadChange(paint);
    timer = window.setInterval(paint, 250);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [screen, failed, gone]);

  useEffect(() => {
    const onFail = () => setFailed(true);
    window.addEventListener('bitbound:loadfailed', onFail);
    return () => window.removeEventListener('bitbound:loadfailed', onFail);
  }, []);

  return null;
}
