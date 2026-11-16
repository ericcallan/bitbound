import { useUI, type HudState } from './store';
import { audio } from '../game/audio/AudioEngine';

interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

const MEADOWS: Room[] = [
  { id: 'field', x: 30, y: 210, w: 50, h: 43, label: 'Awakening Field' },
  { id: 'ruins', x: 84, y: 200, w: 78, h: 53, label: 'Shard Ruins' },
  { id: 'falls', x: 166, y: 214, w: 42, h: 39, label: 'Falls' },
  { id: 'passage', x: 212, y: 206, w: 46, h: 47, label: 'Broken Passage' },
  { id: 'ridge', x: 262, y: 206, w: 70, h: 47, label: 'Beacon Ridge' },
  { id: 'stair', x: 336, y: 172, w: 38, h: 81, label: 'Painted Stair' },
  { id: 'plateau', x: 378, y: 160, w: 56, h: 40, label: 'Plateau' },
  { id: 'overlook', x: 438, y: 150, w: 30, h: 50, label: 'Frame Gate' },
];
const CHAMBER: Room = { id: 'chamber', x: 216, y: 262, w: 40, h: 28, label: 'Hidden Chamber' };
const ALCOVE: Room = { id: 'alcove', x: 336, y: 262, w: 38, h: 28, label: 'Lamp Alcove' };

/** Neon Verge: outside the dome, on the roofs and streets of the megacity. */
const VERGE: Room[] = [
  { id: 'roof', x: 500, y: 150, w: 70, h: 40, label: 'The Roof' },
  { id: 'market', x: 574, y: 236, w: 120, h: 44, label: 'Market Street' },
  { id: 'billboard', x: 698, y: 150, w: 44, h: 130, label: 'Billboard' },
  { id: 'plaza', x: 746, y: 120, w: 110, h: 50, label: 'Tower Plaza' },
  { id: 'core', x: 860, y: 70, w: 70, h: 100, label: 'Archive Core' },
];
const ALLEY: Room = { id: 'alleyway', x: 620, y: 288, w: 40, h: 24, label: 'Hidden Alley' };

const UNKNOWN = {
  beyond: [
    { x: 520, y: 380, w: 110, h: 60 },
    { x: 650, y: 400, w: 90, h: 80 },
    { x: 760, y: 360, w: 140, h: 56 },
  ],
};

/** Metroidvania world-map concept: explored meadows, undiscovered regions above and below. */
export function WorldMap({ overlay = false, onClose, hud: hudOverride }: { overlay?: boolean; onClose?: () => void; hud?: HudState }) {
  const storeHud = useUI((s) => s.hud);
  const hud = hudOverride ?? storeHud;
  const visited = new Set(hud.visited);
  const room = hud.room;
  const all = [...MEADOWS, CHAMBER, ALCOVE, ...VERGE, ALLEY];
  const inCity = hud.zone === 'verge';
  const here = all.find((r) => r.id === room) ?? MEADOWS[0];

  const map = (
    <svg className="worldmap" viewBox="0 0 1000 600" role="img" aria-label="World map">
      <defs>
        <linearGradient id="wm-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1d3b8a" />
          <stop offset="1" stopColor="#3a7bd5" />
        </linearGradient>
        <linearGradient id="wm-earth" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3b2a3f" />
          <stop offset="1" stopColor="#120f24" />
        </linearGradient>
        <pattern id="wm-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,0.05)" />
        </pattern>
        <filter id="wm-glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="1000" height="600" fill="#0b0816" />
      {/* the meadow is a painted sky inside a dome on a tower roof */}
      <path d="M10 300 Q 250 -40 490 300 Z" fill="url(#wm-sky)" opacity={hud.gatePassed ? 0.55 : 1} />
      <path d="M10 300 Q 250 -40 490 300" fill="none" stroke="#bfe3ff" strokeWidth="2" strokeDasharray={hud.gatePassed ? '6 4' : '0'} opacity="0.7" />
      <rect y="300" width="1000" height="300" fill="url(#wm-earth)" />
      <rect width="1000" height="600" fill="url(#wm-grid)" />
      <path d="M10 300 Q 120 288 250 300 T 490 298 V 312 H 10 Z" fill="#4cc24a" opacity="0.9" />
      <path d="M490 300 H 1000 V 312 H 490 Z" fill="#2a2440" />
      <text x="20" y="30" className="wm-strata">THE DOME</text>
      <text x="20" y="340" className="wm-strata">MEGATOWER</text>
      <text x="20" y="580" className="wm-strata">THE STREETS BELOW</text>

      {/* routes */}
      <g className="wm-route">
        <path d="M468 175 H500" className={hud.gatePassed ? '' : 'wm-route--unknown'} />
        <path d="M236 253 V262" className="wm-route--depth" />
        <path d="M355 253 V262" className="wm-route--depth" />
        <path d="M570 180 L574 236" />
        <path d="M694 258 H698" />
        <path d="M742 150 H746" />
        <path d="M856 140 H860" />
        <path d="M640 280 V288" className="wm-route--depth" />
        <path d="M700 300 V380" className="wm-route--unknown" />
      </g>

      {/* undiscovered regions */}
      {Object.entries(UNKNOWN).map(([k, rooms]) => (
        <g key={k} className={`wm-unknown wm-unknown--${k}`}>
          {rooms.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="6" />
          ))}
        </g>
      ))}
      <text className="wm-region" x="560" y="520">Unrendered — the city below</text>

      {/* explored region */}
      <text className="wm-region wm-region--known" x="150" y="140">Pixel Meadows</text>
      <text className={`wm-region ${hud.gatePassed ? 'wm-region--known' : ''}`} x="560" y="60">
        {hud.gatePassed ? 'Neon Verge' : '???'}
      </text>
      {VERGE.map((r) => (
        <g key={r.id} className={`wm-room wm-room--city ${visited.has(r.id) ? 'wm-room--seen' : ''}`}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="2" />
        </g>
      ))}
      <g className={`wm-room wm-room--chamber ${visited.has(ALLEY.id) ? 'wm-room--seen' : ''}`}>
        <rect x={ALLEY.x} y={ALLEY.y} width={ALLEY.w} height={ALLEY.h} rx="2" />
      </g>
      {MEADOWS.map((r) => (
        <g key={r.id} className={`wm-room ${visited.has(r.id) ? 'wm-room--seen' : ''}`}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="5" />
        </g>
      ))}
      {[CHAMBER, ALCOVE].map((R) => (
        <g key={R.id} className={`wm-room wm-room--chamber ${visited.has(R.id) ? 'wm-room--seen' : ''}`}>
          <path d={`M${R.x} ${R.y + 8} l8 -8 h${R.w} v${R.h - 8} l-8 8 h-${R.w} Z`} />
          <path d={`M${R.x} ${R.y + 8} h${R.w} l8 -8 M${R.x + R.w} ${R.y + 8} v${R.h - 8}`} className="wm-iso" />
          <text x={R.x + 4} y={R.y + R.h + 16} className="wm-small">
            {visited.has(R.id) ? '3D' : '?'}
          </text>
        </g>
      ))}

      {/* upgrades */}
      <Marker x={123} y={226} got={hud.shardTaken} label="Generation Shard" />
      <Marker x={235} y={228} got={hud.shiftUnlocked} label="Dimension Core" />
      <Marker x={453} y={170} got={hud.gatePassed} label="Frame Gate" />
      <Marker x={300} y={200} got={hud.regress} label="Regress" />
      <Marker x={535} y={170} got={hud.armed || inCity} label="Pulse Emitter" />

      {/* landmarks */}
      <g className="wm-landmark">
        <path d="M258 236 h4" stroke={hud.bridgeRepaired ? '#ffd36b' : '#ff6b6b'} strokeWidth="3" strokeDasharray={hud.bridgeRepaired ? '0' : '1 2'} />
        <circle cx="300" cy="222" r="5" className="wm-beacon" />
        <path d="M342 245 l6 -10 l6 -10 l6 -10 l6 -10" stroke={hud.stairRepaired ? '#ffcf6b' : 'rgba(255,207,107,0.35)'} strokeWidth="3" fill="none" strokeDasharray={hud.stairRepaired ? '0' : '3 5'} />
      </g>

      {/* you are here */}
      <g className="wm-here" transform={`translate(${here.x + here.w / 2} ${here.y + here.h / 2})`} filter="url(#wm-glow)">
        <circle r="14" className="wm-here__pulse" />
        <rect x="-7" y="-6" width="14" height="12" rx="3" fill="#fff4d6" />
        <rect x="-5" y="-4" width="10" height="7" rx="2" fill="#141a33" />
        <rect x="-3.5" y="-2.5" width="2" height="3" fill="#6ff6ff" />
        <rect x="1.5" y="-2.5" width="2" height="3" fill="#6ff6ff" />
        <rect x="-0.7" y="-11" width="1.4" height="5" fill="#8e5bd6" />
      </g>

      <g className="wm-legend" transform="translate(40 520)">
        <rect width="14" height="10" rx="2" className="wm-legend--seen" />
        <text x="22" y="10">Explored</text>
        <rect x="110" width="14" height="10" rx="2" className="wm-legend--unknown" />
        <text x="132" y="10">Undiscovered</text>
        <path d="M245 5 l6 -6 l6 6 l-6 6 Z" className="wm-legend--upgrade" />
        <text x="262" y="10">Upgrade</text>
      </g>
    </svg>
  );

  if (!overlay) return map;
  return (
    <div className="overlay overlay--map" data-era={hud.era} onClick={onClose}>
      <div className="mapframe" onClick={(e) => e.stopPropagation()}>
        <div className="mapframe__head">
          <h2>The Frame</h2>
          <span>
            {all.filter((r) => visited.has(r.id)).length} / {all.length} places seen
          </span>
          <button
            className="menu__btn menu__btn--small"
            onClick={() => {
              audio.sfx('click');
              onClose?.();
            }}
          >
            Close <kbd>M</kbd>
          </button>
        </div>
        {map}
      </div>
    </div>
  );
}

function Marker({ x, y, got, label }: { x: number; y: number; got?: boolean; label: string }) {
  return (
    <g className={`wm-marker ${got ? 'wm-marker--got' : ''}`} transform={`translate(${x} ${y})`}>
      <path d="M0 -8 L8 0 L0 8 L-8 0 Z" />
      <title>{label}</title>
    </g>
  );
}
