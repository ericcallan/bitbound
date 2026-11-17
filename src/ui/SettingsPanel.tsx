import { useUI } from './store';
import { audio } from '../game/audio/AudioEngine';
import { clearSave } from '../game/save/save';
import { session } from './session';
import { ERA_NAMES, ERAS } from '../game/era/EraSystem';
import type { QualitySetting } from '../game/render/post/Pipeline';

export function SettingsPanel() {
  const ui = useUI();
  const s = ui.settings;
  const era = ui.screen === 'game' ? ui.hud.era : 4;
  const canPickEra = ui.screen === 'game' && ui.hud.eraKeys;
  return (
    <div className="overlay" data-era={era}>
      <div className="panel panel--settings">
        <h2 className="panel__title">Settings</h2>
        <label className="setting">
          <span>Music</span>
          <input type="range" min={0} max={1} step={0.05} value={s.music} onChange={(e) => ui.updateSettings({ music: +e.target.value })} />
        </label>
        <label className="setting">
          <span>Sound effects</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.sfx}
            onChange={(e) => ui.updateSettings({ sfx: +e.target.value })}
            onPointerUp={() => audio.sfx('collect', 1)}
          />
        </label>
        <label className="setting">
          <span>Graphics quality</span>
          <select value={s.quality} onChange={(e) => ui.updateSettings({ quality: e.target.value as QualitySetting })}>
            <option value="auto">Auto</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        {canPickEra && (
          <div className="setting setting--eras">
            <span>Generation</span>
            <div className="era-picker">
              {ERAS.map((e) => (
                <button
                  key={e}
                  className={`chip ${ui.hud.era === e ? 'is-on' : ''}`}
                  title={ERA_NAMES[e]}
                  onClick={() => {
                    audio.sfx('click');
                    session.game?.changeEra(e, 1.8);
                  }}
                >
                  {e + 1}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="setting setting--toggle">
          <span>Screen shake</span>
          <input type="checkbox" checked={s.shake} onChange={(e) => ui.updateSettings({ shake: e.target.checked })} />
        </label>
        <label className="setting setting--toggle">
          <span>Show FPS</span>
          <input type="checkbox" checked={s.showFps} onChange={(e) => ui.updateSettings({ showFps: e.target.checked })} />
        </label>
        {ui.screen === 'menu' && (
          <button
            className="menu__btn menu__btn--danger"
            onClick={() => {
              clearSave();
              audio.sfx('fizzle');
              ui.setSettingsOpen(false);
              ui.setScreen('menu');
            }}
          >
            Erase save data
          </button>
        )}
        <button className="menu__btn menu__btn--primary" onClick={() => (audio.sfx('click'), ui.setSettingsOpen(false))}>
          Done
        </button>
      </div>
    </div>
  );
}
