import { useUI } from './store';
import { session } from './session';
import { audio } from '../game/audio/AudioEngine';

export function FinaleCard() {
  const ui = useUI();
  const hud = ui.hud;
  if (!hud.finaleCard) return null;
  return (
    <div className="finale" data-era={hud.era}>
      <div className="finale__card">
        <div className="finale__kicker">The world wheel turns</div>
        <h2 className="finale__title">The Waking World</h2>
        <div className="finale__stats">
          <div>
            <b>{hud.bits}</b>
            <span>/ {hud.totalBits} bits</span>
          </div>
          <div>
            <b>6</b>
            <span>generations restored</span>
          </div>
          <div>
            <b>PIP</b>
            <span>helper, unfolded</span>
          </div>
        </div>
        <p className="finale__teaser">
          Winter is over. ARCHIVE remembers what it was waiting for, and the valley wakes up in every generation at
          once. Beyond Mount Halo the rest of the world is still folded small, and something down there is starting
          to stir.
        </p>
        <p className="finale__unlock">
          New: press <kbd>1</kbd>–<kbd>6</kbd> to switch generations anytime. "Keep exploring" stays at the summit.
        </p>
        <div className="finale__buttons">
          <button
            className="menu__btn menu__btn--primary"
            onClick={() => {
              audio.sfx('click');
              session.game?.continueAfterFinale();
            }}
          >
            Keep exploring
          </button>
          <button className="menu__btn" onClick={() => (audio.sfx('click'), ui.setMap(true))}>
            World map
          </button>
          <button
            className="menu__btn"
            onClick={() => {
              audio.sfx('click');
              session.game = null;
              ui.setScreen('menu');
            }}
          >
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
