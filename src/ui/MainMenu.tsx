import { useEffect, useState } from 'react';
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
        {ERA_NAMES.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <div className="menu__panel">
        <h1 className="logo" aria-label="PIP — Beyond the Frame">
          <span className="logo__pip">
            {'PIP'.split('').map((c, i) => (
              <span key={i} className={`logo__letter logo__letter--${i}`}>
                {c}
              </span>
            ))}
          </span>
          <span className="logo__sub">Beyond the Frame</span>
        </h1>
        <nav className="menu__buttons">
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
            <span className="menu__btn-icon">▶</span> {hasSave ? 'New Game' : 'Play'}
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
            <span className="menu__btn-icon">✦</span> Art &amp; Design
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
        <span><kbd>A</kbd><kbd>D</kbd> move</span>
        <span><kbd>Space</kbd> jump</span>
        <span><kbd>E</kbd> dimension shift</span>
        <span><kbd>W</kbd><kbd>S</kbd> depth (3D)</span>
        <span><kbd>M</kbd> map</span>
        <span><kbd>Esc</kbd> pause</span>
      </footer>
    </div>
  );
}
