import { useEffect, useState } from 'react';
import { useUI, type HudState } from './store';
import { Portrait } from './Portrait';
import { ERA_NAMES, ERAS } from '../game/era/EraSystem';

const SHIFT_LABEL: Record<HudState['shift'], string> = {
  hidden: '',
  locked: 'Core dormant',
  ready: 'Shift ready',
  blocked: 'Shift blocked',
  active: 'Shifting…',
};

const ERA_SHORT = ['8-BIT', '16-BIT', 'EARLY 3D', 'STYLIZED', 'MODERN', 'BEYOND'];

export function HUD() {
  const hud = useUI((s) => s.hud);
  return <HudView hud={hud} />;
}

function Dialogue({ hud }: { hud: HudState }) {
  const d = hud.dialogue;
  if (!d) return null;
  return (
    <div className={`dialogue dialogue--${d.speaker.toLowerCase()}`} key={d.id} data-era={hud.zone === 'verge' ? 5 : hud.era}>
      <span className="dialogue__who">{d.speaker}</span>
      <span className="dialogue__text">{d.text}</span>
    </div>
  );
}

function Prompt({ hud }: { hud: HudState }) {
  if (!hud.prompt) return null;
  return (
    <div className={`hud__prompt hud__prompt--${hud.prompt.tone ?? 'info'}`} key={hud.prompt.text}>
      {hud.prompt.keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
      <span>{hud.prompt.text}</span>
    </div>
  );
}

function Banner({ hud }: { hud: HudState }) {
  if (!hud.banner) return null;
  return (
    <div className="banner" data-era={hud.banner.era} key={hud.banner.id}>
      <div className="banner__title">{hud.banner.title}</div>
      <div className="banner__sub">{hud.banner.subtitle}</div>
    </div>
  );
}

/** Hold Q: a ring of the generations Pip's core remembers. */
function Wheel({ hud }: { hud: HudState }) {
  if (!hud.wheelOpen) return null;
  return (
    <div className="wheel">
      {ERAS.map((e) => {
        const a = (e / 6) * Math.PI * 2 - Math.PI / 2;
        const locked = e > hud.maxEraUnlocked;
        return (
          <div
            key={e}
            className={`wheel__slot ${e === hud.regressEra ? 'wheel__slot--sel' : ''} ${locked ? 'wheel__slot--locked' : ''}`}
            style={{ transform: `translate(${Math.cos(a) * 150}px, ${Math.sin(a) * 150}px)` }}
            data-era={e}
          >
            <kbd>{e + 1}</kbd>
            <span>{ERA_SHORT[e]}</span>
          </div>
        );
      })}
      <div className="wheel__hub">
        <div className="wheel__title">REGRESS</div>
        <div className="wheel__hint">{hud.bubbleEra >= 0 ? 'release on the same generation to drop it' : 'pick a generation, release Q'}</div>
      </div>
    </div>
  );
}

/** The city HUD: lean, diegetic-feeling chrome over a shooter. */
function CityHud({ hud, isStatic }: { hud: HudState; isStatic: boolean }) {
  const heatPct = Math.round(hud.heat * 100);
  return (
    <div className="hud hud--city" data-era={hud.era} data-cine={hud.cinematic ? 1 : 0}>
      <div className="chud__top">
        <div className="chud__vitals">
          <div className="chud__id">
            <span className="chud__name">PIP-7</span>
            <span className="chud__era">{ERA_NAMES[hud.era]}</span>
          </div>
          <div className="chud__cells" aria-label={`Integrity ${hud.cells} of ${hud.maxCells}`}>
            {Array.from({ length: hud.maxCells }, (_, i) => (
              <span key={i} className={`chud__cell ${i < hud.cells ? 'on' : ''}`} />
            ))}
          </div>
          {hud.objective && <div className="chud__objective">{hud.objective}</div>}
        </div>
        {hud.boss && (
          <div className="chud__boss">
            <div className="chud__boss-name">
              {hud.boss.name} <em>{hud.boss.state}</em>
            </div>
            <div className="chud__boss-bar">
              <span style={{ width: `${(hud.boss.hp / hud.boss.max) * 100}%` }} />
            </div>
          </div>
        )}
        <div className="chud__right">
          <div className="chud__bits">
            <span className="bit-icon" /> {String(hud.bits).padStart(2, '0')}
            <span className="hud__bits-total">/{hud.totalBits}</span>
          </div>
          {hud.regress && (
            <div className={`chud__regress ${hud.bubbleEra >= 0 ? 'on' : ''}`}>
              <kbd>Q</kbd> {hud.bubbleEra >= 0 ? `BUBBLE · ${ERA_SHORT[hud.bubbleEra]}` : 'REGRESS'}
            </div>
          )}
          {hud.shift !== 'hidden' && hud.shift !== 'locked' && (
            <div className={`chud__shift chud__shift--${hud.shift}`}>
              {hud.mode3d ? '3D' : '2D'} · {SHIFT_LABEL[hud.shift]} {hud.shift === 'ready' && <kbd>E</kbd>}
            </div>
          )}
        </div>
      </div>
      {hud.shooter && !hud.cinematic && (
        <div className={`crosshair ${hud.aiming ? 'crosshair--aim' : ''} ${hud.overheated ? 'crosshair--hot' : ''} ${hud.weaponOffline ? 'crosshair--off' : ''}`}>
          <span />
          <span />
          <span />
          <span />
          <i />
        </div>
      )}
      {hud.armed && (
        <div className={`chud__heat ${hud.overheated ? 'hot' : ''} ${hud.weaponOffline ? 'off' : ''}`}>
          <div className="chud__heat-label">{hud.weaponOffline ? 'EMITTER OFFLINE · 8-BIT' : hud.overheated ? 'VENTING' : 'PULSE EMITTER'}</div>
          <div className="chud__heat-bar">
            <span style={{ width: `${heatPct}%` }} />
          </div>
          <div className="chud__heat-keys">
            <kbd>LMB</kbd> fire <kbd>RMB</kbd> aim <kbd>F</kbd> charge <kbd>Shift</kbd> dash
          </div>
        </div>
      )}
      {!isStatic && <Dialogue hud={hud} />}
      {!isStatic && <Prompt hud={hud} />}
      {!isStatic && <Banner hud={hud} />}
      {!isStatic && <Wheel hud={hud} />}
    </div>
  );
}

/** Chapter 1: one line of text, like the earliest consoles. */
function BareHud({ hud, isStatic }: { hud: HudState; isStatic: boolean }) {
  return (
    <div className="hud hud--bare" data-era={0} data-cine={hud.cinematic ? 1 : 0}>
      <div className="bare__line">
        <span>PIP ×{hud.cells}</span>
        <span>BITS {String(hud.bits).padStart(2, '0')}</span>
        {hud.shift !== 'hidden' && hud.shift !== 'locked' && <span>{hud.mode3d ? '3D' : '2D'}</span>}
      </div>
      {!isStatic && <Dialogue hud={hud} />}
      {!isStatic && <Prompt hud={hud} />}
      {!isStatic && <Banner hud={hud} />}
      {!isStatic && <Wheel hud={hud} />}
    </div>
  );
}

/** Stateless HUD so the gallery can render every era skin side by side. */
export function HudView({ hud, static: isStatic = false }: { hud: HudState; static?: boolean }) {
  const [bump, setBump] = useState(0);
  useEffect(() => setBump((b) => b + 1), [hud.bits]);
  if (hud.zone === 'verge') return <CityHud hud={hud} isStatic={isStatic} />;
  const era = hud.era;
  if (era === 0) return <BareHud hud={hud} isStatic={isStatic} />;
  return (
    <div className={`hud ${isStatic ? 'hud--static' : ''}`} data-era={era} data-cine={hud.cinematic ? 1 : 0}>
      <div className="hud__left">
        <div className="hud__portrait">
          <Portrait expression={hud.expression} era={era} size={era >= 4 ? 60 : 56} />
        </div>
        <div className="hud__stats">
          <div className="hud__cells" aria-label={`Energy ${hud.cells} of ${hud.maxCells}`}>
            {Array.from({ length: hud.maxCells }, (_, i) => (
              <span key={i} className={`cell ${i < hud.cells ? 'cell--on' : ''}`} />
            ))}
          </div>
          <div className="hud__bits" key={bump}>
            <span className="bit-icon" />
            <span className="hud__bits-n">{String(hud.bits).padStart(2, '0')}</span>
            <span className="hud__bits-total">/{hud.totalBits}</span>
          </div>
          {hud.objective && !isStatic && <div className="hud__objective">{hud.objective}</div>}
        </div>
      </div>
      <div className="hud__right">
        <div className="hud__era">
          <span className="hud__era-dot" />
          {ERA_NAMES[era]}
        </div>
        {hud.shift !== 'hidden' && (
          <div className={`hud__shift hud__shift--${hud.shift}`}>
            <span className="shift-icon" data-mode={hud.mode3d ? '3d' : '2d'}>
              <span />
            </span>
            <span className="hud__shift-text">
              {hud.mode3d ? '3D' : '2D'} · {SHIFT_LABEL[hud.shift]}
            </span>
            {hud.shift === 'ready' && <kbd>E</kbd>}
          </div>
        )}
        {hud.regress && (
          <div className={`hud__regress ${hud.bubbleEra >= 0 ? 'on' : ''}`}>
            <kbd>Q</kbd> {hud.bubbleEra >= 0 ? `Bubble · ${ERA_NAMES[hud.bubbleEra as 0]}` : 'Regress'}
          </div>
        )}
      </div>
      {!isStatic && <Dialogue hud={hud} />}
      {!isStatic && <Prompt hud={hud} />}
      {!isStatic && <Banner hud={hud} />}
      {!isStatic && <Wheel hud={hud} />}
    </div>
  );
}
