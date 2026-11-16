import { useUI } from './store';
import { session } from './session';
import { audio } from '../game/audio/AudioEngine';

export function PauseMenu() {
  const ui = useUI();
  if (!ui.paused || ui.settingsOpen) return null;
  const era = ui.hud.era;
  const click = () => audio.sfx('click');
  return (
    <div className="overlay" data-era={era}>
      <div className="panel">
        <h2 className="panel__title">Paused</h2>
        <div className="panel__buttons">
          <button className="menu__btn menu__btn--primary" onClick={() => (click(), ui.setPaused(false))}>
            Resume
          </button>
          <button className="menu__btn" onClick={() => (click(), ui.setPaused(false), ui.setMap(true))}>
            World Map
          </button>
          <button className="menu__btn" onClick={() => (click(), ui.setSettingsOpen(true))}>
            Settings
          </button>
          <button
            className="menu__btn"
            onClick={() => {
              click();
              session.game = null;
              ui.setScreen('menu');
            }}
          >
            Main Menu
          </button>
        </div>
        <p className="panel__hint">Progress is saved at every checkpoint.</p>
      </div>
    </div>
  );
}
