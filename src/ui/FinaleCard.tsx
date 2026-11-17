import { useUI } from './store';
import { session } from './session';
import { audio } from '../game/audio/AudioEngine';
import { ShareButton } from './ShareButton';

export function FinaleCard() {
  const ui = useUI();
  const hud = ui.hud;
  if (!hud.finaleCard) return null;
  return (
    <div className="finale" data-era={hud.era}>
      <div className="finale__card">
        <div className="finale__kicker">Update complete</div>
        <h2 className="finale__title">Every Version at Once</h2>
        <div className="finale__stats">
          <div>
            <b>{hud.bits}</b>
            <span>/ {hud.totalBits} bits</span>
          </div>
          <div>
            <b>6</b>
            <span>updates delivered</span>
          </div>
          <div>
            <b>PIP</b>
            <span>courier, fully updated</span>
          </div>
        </div>
        <p className="finale__teaser">
          The world wheel turns again, and the valley wakes up in every generation at once. Down past Mount Halo,
          the rest of the world is still on version 1.0. <em>Update available.</em>
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
          <ShareButton className="menu__btn" text={`I delivered every update in Bitbound, from version 1.0 to Beyond, with ${hud.bits}/${hud.totalBits} bits:`} />
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
