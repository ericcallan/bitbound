import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUI } from './store';
import { canContinue, startGame } from './session';
import { audio } from '../game/audio/AudioEngine';
import { ERA_NAMES } from '../game/era/EraSystem';
import { CHAPTERS } from '../game/sim/Game';
import { LEVEL } from '../game/level/meadows';
import { loadSave } from '../game/save/save';

function wakeAudio() {
  audio.init();
  audio.startMusic();
}

/** One consistent icon set (24px grid, 2px rounded strokes) instead of font glyphs. */
const Icon = {
  play: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  ),
  resume: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  ),
  extras: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
};

const HALO_CHECKPOINTS = new Set(['halo', 'thicket', 'relief', 'seal', 'summit']);

/** "The Waking World · 46/65 bits · 2 h ago" for the Continue button. */
function saveSummary(): string | null {
  const s = loadSave();
  if (!s) return null;
  const chapter = CHAPTERS[HALO_CHECKPOINTS.has(s.checkpoint) ? 5 : Math.min(4, s.era)].replace(/^Ch \d+ · /, '');
  const parts = [chapter, `${s.bits.length}/${LEVEL.bits.length} bits`];
  if (s.savedAt > 0) {
    const mins = Math.max(0, Math.round((Date.now() - s.savedAt) / 60000));
    parts.push(mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 60 * 24 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`);
  }
  return parts.join(' · ');
}

interface ButtonDef {
  icon: ReactNode;
  label: string;
  meta?: string | null;
  primary?: boolean;
  onClick: () => void;
}

/** Phones and small touch screens: the game needs a keyboard or gamepad. */
function isPhoneLike() {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
    return coarse || window.innerWidth < 720;
  } catch {
    return false;
  }
}

function DesktopNotice({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="device-notice" role="dialog" aria-label="Best on desktop">
      <div className="device-notice__card">
        <div className="device-notice__icon" aria-hidden>
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
        </div>
        <h2>PIP is built for desktop</h2>
        <p>It plays with a keyboard or a gamepad, and it needs a larger screen. There are no touch controls yet.</p>
        <button className="title-btn title-btn--primary device-notice__btn" onClick={onContinue}>
          <span className="title-btn__text">
            <span className="title-btn__label">Try anyway</span>
            <span className="title-btn__meta">Starts on Low quality</span>
          </span>
        </button>
      </div>
    </div>
  );
}

function MenuButton(props: ButtonDef & { index: number }) {
  return (
    <button
      className={`title-btn ${props.primary ? 'title-btn--primary' : ''}`}
      style={{ animationDelay: `${0.35 + props.index * 0.07}s` }}
      onMouseEnter={(e) => {
        if (document.activeElement !== e.currentTarget) audio.sfx('hover');
        e.currentTarget.focus({ preventScroll: true });
      }}
      onClick={props.onClick}
    >
      <span className="title-btn__icon">{props.icon}</span>
      <span className="title-btn__text">
        <span className="title-btn__label">{props.label}</span>
        {props.meta && <span className="title-btn__meta">{props.meta}</span>}
      </span>
      <span className="title-btn__chevron">{Icon.chevron}</span>
    </button>
  );
}

export function MainMenu() {
  const [hasSave, setHasSave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [phone, setPhone] = useState(() => isPhoneLike());
  const ui = useUI();
  const nav = useRef<HTMLElement>(null);
  const summary = useMemo(() => (hasSave ? saveSummary() : null), [hasSave]);

  // Arrow keys / d-pad move between the buttons; Enter or A selects the focused one.
  useEffect(() => {
    const move = (dir: 1 | -1) => {
      if (!nav.current) return;
      const buttons = [...nav.current.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const n = buttons.length;
      buttons[i < 0 ? 0 : (i + dir + n) % n].focus();
      audio.sfx('hover');
    };
    const onKey = (e: KeyboardEvent) => {
      if (confirmNew) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        move(e.key === 'ArrowDown' ? 1 : -1);
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
      if ((now.up && !prev.up) || (now.down && !prev.down)) move(now.down ? 1 : -1);
      if (now.a && !prev.a) {
        const buttons = [...nav.current.querySelectorAll('button')];
        (buttons.find((b) => b === document.activeElement) ?? buttons[0]).click();
      }
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

  const buttons: ButtonDef[] = [
    {
      icon: Icon.play,
      label: 'New Game',
      primary: true,
      onClick: () => {
        if (hasSave) {
          audio.sfx('click');
          setConfirmNew(true);
        } else go(false);
      },
    },
    ...(hasSave ? [{ icon: Icon.resume, label: 'Continue', meta: summary, onClick: () => go(true) }] : []),
    {
      icon: Icon.settings,
      label: 'Settings',
      onClick: () => {
        wakeAudio();
        audio.sfx('click');
        ui.setSettingsOpen(true);
      },
    },
    {
      icon: Icon.extras,
      label: 'Extras',
      meta: 'Art & design gallery',
      onClick: () => {
        wakeAudio();
        audio.sfx('click');
        ui.setScreen('gallery');
      },
    },
  ];

  return (
    <div className={`menu ${leaving ? 'menu--leaving' : ''}`}>
      <div className="menu__scrim" aria-hidden />
      <div className="menu__era-labels" aria-hidden>
        {ERA_NAMES.map((n, i) => (
          <span key={n}>
            <em>{String(i + 1).padStart(2, '0')}</em>
            {n}
          </span>
        ))}
      </div>
      <div className="menu__panel">
        <h1 className="logo" aria-label="PIP — Beyond the Frame">
          <span className="logo__mark">
            <span className="logo__orbit" aria-hidden>
              <i />
            </span>
            {[0, 1, 2, 3].map((i) => (
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
        <nav className="title-menu" ref={nav} aria-label="Main menu">
          {buttons.map((b, i) => (
            <MenuButton key={b.label} index={i} {...b} />
          ))}
        </nav>
      </div>
      {phone && (
        <DesktopNotice
          onContinue={() => {
            ui.updateSettings({ quality: 'low' });
            setPhone(false);
          }}
        />
      )}
      {confirmNew && (
        <div className="overlay" data-era={4} onClick={() => setConfirmNew(false)}>
          <div className="panel" role="dialog" aria-label="Start a new game?" onClick={(e) => e.stopPropagation()}>
            <h2 className="panel__title">New game?</h2>
            <p className="panel__hint">Starting over erases your saved progress.</p>
            <div className="panel__buttons">
              <button className="menu__btn menu__btn--danger" onClick={() => (setConfirmNew(false), go(false))}>
                Erase and start over
              </button>
              <button className="menu__btn menu__btn--primary" autoFocus onClick={() => (setConfirmNew(false), go(true))}>
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
        <span className="menu__footer-meta">v0.6 · Preview build</span>
        <span className="menu__footer-hints">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd>
            <kbd className="pad">A</kbd> Select
          </span>
        </span>
        <span className="menu__footer-meta menu__footer-meta--right">Best with keyboard or gamepad</span>
      </footer>
    </div>
  );
}
