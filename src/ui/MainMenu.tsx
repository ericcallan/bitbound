import { useEffect, useRef, useState } from 'react';
import { useUI } from './store';
import { canContinue, startGame } from './session';
import { audio } from '../game/audio/AudioEngine';
import { ERA_NAMES } from '../game/era/EraSystem';

function wakeAudio() {
  audio.init();
  audio.startMusic();
}

export function MainMenu() {
  const [hasSave, setHasSave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const ui = useUI();

  const nav = useRef<HTMLElement>(null);
  // Arrow keys / d-pad move between the buttons; Enter or A selects the focused one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmNew || !nav.current) return;
      const buttons = [...nav.current.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = buttons.length;
        const next = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        buttons[next].focus();
        audio.sfx('hover');
      }
    };
    window.addEventListener('keydown', onKey);
    // Gamepad: d-pad or stick to choose, A to select.
    let raf = 0;
    let prev = { up: false, down: false, a: false };
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const p = navigator.getGamepads?.().find((g) => g);
      if (!p || confirmNew || !nav.current) return;
      const now = {
        up: !!p.buttons[12]?.pressed || (p.axes[1] ?? 0) < -0.6,
        down: !!p.buttons[13]?.pressed || (p.axes[1] ?? 0) > 0.6,
        a: !!p.buttons[0]?.pressed,
      };
      const buttons = [...nav.current.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if ((now.up && !prev.up) || (now.down && !prev.down)) {
        const n = buttons.length;
        buttons[i < 0 ? 0 : (i + (now.down ? 1 : n - 1)) % n].focus();
        audio.sfx('hover');
      }
      if (now.a && !prev.a) (buttons[i] ?? buttons[0]).click();
      prev = now;
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    };
  }, [confirmNew]);

  useEffect(() => {
    setHasSave(canContinue());
    audio.setEra(1);
    const once = () => wakeAudio();
    window.addEventListener('pointerdown', once, { once: true });
    window.addEventListener('keydown', once, { once: true });
    return () => {
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
  }, []);

  const go = (resume: boolean) => {
    if (leaving) return;
    wakeAudio();
    audio.sfx('click');
    setLeaving(true);
    window.setTimeout(() => {
      const g = startGame(resume);
      audio.setEra(g.era.era);
      ui.newSession();
      ui.setScreen('game');
    }, 450);
  };

  const hover = () => audio.sfx('hover');

  return (
    <div className={`menu ${leaving ? 'menu--leaving' : ''}`}>
      <div className="menu__era-labels" aria-hidden>
        {ERA_NAMES.map((n, i) => (
          <span key={n}>{i === ERA_NAMES.length - 1 ? `✦ ${n} ✦` : n}</span>
        ))}
      </div>
      <div className="menu__panel">
        <h1 className="logo" aria-label="PIP — Beyond the Frame">
          <span className="logo__mark">
            <span className="logo__orbit" aria-hidden />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`logo__spark logo__spark--${i}`} aria-hidden />
            ))}
            <span className="logo__pip">
              {['P', 'i', 'P'].map((c, i) => (
                <span key={i} className={`logo__letter logo__letter--${i}`}>
                  {c}
                </span>
              ))}
            </span>
          </span>
          <span className="logo__sub">Beyond the Frame</span>
          <span className="logo__rule" aria-hidden>
            <i />
          </span>
        </h1>
        <nav className="menu__buttons" ref={nav}>
          <button
            className="menu__btn menu__btn--primary"
            onMouseEnter={hover}
            onClick={() => {
              if (hasSave) {
                audio.sfx('click');
                setConfirmNew(true);
              } else go(false);
            }}
          >
            <span className="menu__btn-icon">▶</span> New Game
          </button>
          {hasSave && (
            <button className="menu__btn" onMouseEnter={hover} onClick={() => go(true)}>
              <span className="menu__btn-icon">↻</span> Continue
            </button>
          )}
          <button
            className="menu__btn"
            onMouseEnter={hover}
            onClick={() => {
              wakeAudio();
              audio.sfx('click');
              ui.setSettingsOpen(true);
            }}
          >
            <span className="menu__btn-icon">⚙</span> Settings
          </button>
          <button
            className="menu__btn"
            onMouseEnter={hover}
            onClick={() => {
              wakeAudio();
              audio.sfx('click');
              ui.setScreen('gallery');
            }}
          >
            <span className="menu__btn-icon">★</span> Extras
          </button>
        </nav>
      </div>
      {confirmNew && (
        <div className="overlay" data-era={4} onClick={() => setConfirmNew(false)}>
          <div className="panel" role="dialog" aria-label="Start a new game?" onClick={(e) => e.stopPropagation()}>
            <h2 className="panel__title">New game?</h2>
            <p className="panel__hint">Starting over erases your saved progress.</p>
            <div className="panel__buttons">
              <button className="menu__btn menu__btn--danger" onClick={() => (setConfirmNew(false), go(false))}>
                Erase and start over
              </button>
              <button className="menu__btn menu__btn--primary" onClick={() => (setConfirmNew(false), go(true))}>
                Continue instead
              </button>
              <button className="menu__btn" onClick={() => setConfirmNew(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="menu__footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Choose
        </span>
        <span className="menu__footer-sep" aria-hidden />
        <span>
          <kbd>Enter</kbd> / <kbd>A</kbd> Select
        </span>
      </footer>
    </div>
  );
}
