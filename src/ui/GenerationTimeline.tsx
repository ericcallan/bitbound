import { ERA_NAMES, generationFlag, type Era } from '../game/era/EraSystem';
import { Portrait } from './Portrait';

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
      <span className="gen-timeline__flag" aria-live="polite">
        {generationFlag(shown)}
      </span>
    </nav>
  );
}
