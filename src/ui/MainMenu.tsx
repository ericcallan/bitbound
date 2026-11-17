import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUI } from './store';
import { canContinue, session, startGame } from './session';
import { audio } from '../game/audio/AudioEngine';
import { ERA_NAMES, type Era } from '../game/era/EraSystem';
import { CHAPTERS } from '../game/sim/Game';
import { LEVEL } from '../game/level/meadows';
import { loadSave } from '../game/save/save';
import { SPRITES } from '../game/render/sprites';
import { Portrait } from './Portrait';
import { ShareButton } from './ShareButton';
import { PixelTitleView } from './title/PixelTitleView';

/**
 * Dev only: ?shot=og shows the title scene with just the wordmark and one line, for the link-preview image
 * (scripts/capture-og.mjs).
 */
const SHOT = import.meta.env.DEV && new URLSearchParams(location.search).get('shot') === 'og';

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
  palette: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
      <circle cx="10" cy="7.2" r="1.2" fill="currentColor" />
      <circle cx="14.6" cy="7.2" r="1.2" fill="currentColor" />
      <circle cx="17.2" cy="11" r="1.2" fill="currentColor" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3.5l9 4.6-9 4.6-9-4.6z" />
      <path d="M3 12.4l9 4.6 9-4.6" />
      <path d="M3 16.4l9 4.6 9-4.6" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 48 24" aria-hidden>
      <path d="M4 12h36" />
      <path d="M32 5l8 7-8 7" />
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
        <h2>Bitbound is built for desktop</h2>
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
      style={{ animationDelay: `${0.3 + props.index * 0.06}s` }}
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

/** The 8-bit Pip sprite, drawn crisp at any size (the left half of the "Break the Frame" card). */
function PixelPip({ scale = 5 }: { scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const rows = SPRITES.pip[0];
    cv.width = rows[0].length;
    cv.height = rows.length;
    const c = cv.getContext('2d')!;
    const pal: Record<string, string> = { k: '#0d0b1e', o: '#0d0b1e', c: '#f4f1e6' };
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        c.fillStyle = pal[ch] ?? '#0d0b1e';
        c.fillRect(x, y, 1, 1);
      }),
    );
  }, []);
  return <canvas ref={ref} className="frame-card__pixel" style={{ width: 16 * scale, height: 16 * scale }} />;
}

/**
 * The six generations as a timeline of Pip's face, top right. Hovering or focusing one ripples the title
 * scene into that generation; leaving the timeline returns it to the selected one (Beyond until you pick).
 */
export function GenerationTimeline({ shown, selected, onPreview, onSelect }: { shown: Era; selected: Era; onPreview: (e: Era | null) => void; onSelect: (e: Era) => void }) {
  return (
    <nav className="gen-timeline" aria-label="Graphics generation" onMouseLeave={() => onPreview(null)}>
      <span className="gen-timeline__line" aria-hidden />
      {ERA_NAMES.map((name, i) => {
        const e = i as Era;
        return (
          <button
            key={name}
            className={`gen-timeline__item ${shown === e ? 'is-shown' : ''} ${selected === e ? 'is-selected' : ''}`}
            aria-pressed={selected === e}
            aria-label={`Show the title scene in ${name}`}
            onMouseEnter={() => onPreview(e)}
            onFocus={() => onPreview(e)}
            onBlur={() => onPreview(null)}
            onClick={() => onSelect(e)}
          >
            <span className="gen-timeline__face">
              <Portrait expression="happy" era={e} size={34} />
            </span>
            <span className="gen-timeline__name">{name}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function MainMenu() {
  const [hasSave, setHasSave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [phone, setPhone] = useState(() => !SHOT && isPhoneLike());
  const [selected, setSelected] = useState<Era>(5);
  const [preview, setPreview] = useState<Era | null>(null);
  const ui = useUI();
  const nav = useRef<HTMLElement>(null);
  const summary = useMemo(() => (hasSave ? saveSummary() : null), [hasSave]);
  const shown = preview ?? selected;

  // The title scene follows the timeline: a ripple from Pip into the shown generation. 8-bit and 16-bit are their
  // own pixel scenes (PixelTitleView), so the 3D set stays in the last 3D generation behind them.
  useEffect(() => {
    const g = session.menuGame;
    if (!g || shown <= 1) return;
    const t = window.setTimeout(() => {
      const p = g.player.pos;
      g.era.start(shown, { x: p.x, y: p.y + 0.8, z: p.z }, 1.6);
    }, 90);
    return () => window.clearTimeout(t);
  }, [shown]);

  const pick = useCallback((e: Era) => {
    audio.sfx('click');
    setSelected(e);
  }, []);

  // Arrow keys / d-pad: up and down move between the buttons, left and right step through the generations.
  useEffect(() => {
    const move = (dir: 1 | -1) => {
      if (!nav.current) return;
      const buttons = [...nav.current.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const n = buttons.length;
      buttons[i < 0 ? 0 : (i + dir + n) % n].focus();
      audio.sfx('hover');
    };
    const step = (dir: 1 | -1) => {
      setPreview(null);
      setSelected((s) => Math.max(0, Math.min(5, s + dir)) as Era);
      audio.sfx('hover');
    };
    const onKey = (e: KeyboardEvent) => {
      if (confirmNew) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    // Gamepad: d-pad or stick to choose, A to select, bumpers or d-pad left/right for the generation.
    let raf = 0;
    let prev = { up: false, down: false, left: false, right: false, a: false };
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const p = navigator.getGamepads?.().find((g) => g);
      if (!p || confirmNew || !nav.current) return;
      const now = {
        up: !!p.buttons[12]?.pressed || (p.axes[1] ?? 0) < -0.6,
        down: !!p.buttons[13]?.pressed || (p.axes[1] ?? 0) > 0.6,
        left: !!p.buttons[14]?.pressed || !!p.buttons[4]?.pressed,
        right: !!p.buttons[15]?.pressed || !!p.buttons[5]?.pressed,
        a: !!p.buttons[0]?.pressed,
      };
      if ((now.up && !prev.up) || (now.down && !prev.down)) move(now.down ? 1 : -1);
      if ((now.left && !prev.left) || (now.right && !prev.right)) step(now.right ? 1 : -1);
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
    audio.setEra(5);
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

  const openGallery = (tab: 'pip' | 'world') => {
    wakeAudio();
    audio.sfx('click');
    ui.setGalleryTab(tab === 'pip' ? 'character' : 'environment');
    ui.setScreen('gallery');
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
    { icon: Icon.palette, label: 'Art & Design', onClick: () => openGallery('pip') },
    { icon: Icon.layers, label: 'Generations', onClick: () => openGallery('world') },
  ];

  return (
    <div className={`menu ${leaving ? 'menu--leaving' : ''} ${SHOT ? 'menu--shot' : ''}`}>
      <PixelTitleView gen={shown <= 1 ? (shown as 0 | 1) : null} />
      <div className="menu__scrim" aria-hidden />
      <div className="menu__panel">
        <h1 className="logo" aria-label="Bitbound">
          <span className="logo__mark">
            <span className="logo__pixels" aria-hidden>
              {Array.from({ length: 14 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            <span className="logo__word">
              <span className="logo__letter logo__letter--bit">BIT</span>
              <span className="logo__letter logo__letter--bound">BOUND</span>
            </span>
            <span className="logo__swoosh" aria-hidden />
          </span>
          <span className="logo__rule" aria-hidden>
            <i />
          </span>
          {SHOT && <span className="logo__tagline">From 8-bit to beyond.</span>}
        </h1>
        <nav className="title-menu" ref={nav} aria-label="Main menu">
          {buttons.map((b, i) => (
            <MenuButton key={b.label} index={i} {...b} />
          ))}
        </nav>
      </div>

      <GenerationTimeline shown={shown} selected={selected} onPreview={setPreview} onSelect={pick} />

      <aside className="frame-card" aria-label="Break the Frame">
        <div className="frame-card__art" aria-hidden>
          <div className="frame-card__flat">
            <PixelPip />
          </div>
          <span className="frame-card__arrow">{Icon.arrow}</span>
          <div className="frame-card__deep">
            <img src={`${import.meta.env.BASE_URL}ui/pip_hd.webp`} alt="" draggable={false} />
          </div>
        </div>
        <div className="frame-card__text">
          <h2>Break the Frame</h2>
          <p>Shift perspective to discover new paths and hidden worlds.</p>
        </div>
      </aside>

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
        <span className="menu__footer-hints">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> Generation
          </span>
          <span>
            <kbd>Enter</kbd>
            <kbd className="pad">A</kbd> Select
          </span>
        </span>
        <span className="menu__footer-row">
          <ShareButton className="share-btn--quiet" label="Share Bitbound" />
          <span className="menu__footer-meta">v0.7 · Preview build · Best with keyboard or gamepad</span>
        </span>
      </footer>
    </div>
  );
}
