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
        <div className="finale__kicker">The Frame is open</div>
        <h2 className="finale__title">Fidelity Is Truth</h2>
        <div className="finale__stats">
          <div>
            <b>{hud.bits}</b>
            <span>/ {hud.totalBits} bits</span>
          </div>
          <div>
            <b>6</b>
            <span>generations lived</span>
          </div>
          <div>
            <b>PIP-7</b>
            <span>grown up</span>
          </div>
        </div>
        <p className="finale__teaser">
          ARCHIVE still runs the Frame — but every citizen now chooses how much of the world they see. Under the
          opened dome a small sprite looks up and sees rain for the first time. Past Neon Verge, the lights go on
          for miles. Something out there was never rendered at all.
        </p>
        <p className="finale__unlock">
          New: press <kbd>1</kbd>–<kbd>6</kbd> to switch generations anytime. "Keep exploring" returns you to the city.
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
