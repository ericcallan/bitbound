import { useEffect, useRef, useState } from 'react';
import { shareGame } from './share';
import { audio } from '../game/audio/AudioEngine';

const ShareIcon = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 15V3.5" />
    <path d="M7.5 8L12 3.5 16.5 8" />
    <path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
  </svg>
);

/**
 * Share Bitbound: the system share sheet where there is one, else copies the link and says so. The status is
 * announced to screen readers.
 */
export function ShareButton({ className = '', text, label = 'Share' }: { className?: string; text?: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`share-btn ${status !== 'idle' ? `share-btn--${status}` : ''} ${className}`}
      onClick={async (e) => {
        e.currentTarget.blur();
        audio.sfx('click');
        const r = await shareGame(text);
        if (r === 'copied' || r === 'failed') {
          setStatus(r);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setStatus('idle'), 2200);
        }
      }}
    >
      <span className="share-btn__icon">{ShareIcon}</span>
      <span className="share-btn__label" aria-live="polite">
        {status === 'copied' ? 'Link copied' : status === 'failed' ? "Couldn't copy the link" : label}
      </span>
    </button>
  );
}
