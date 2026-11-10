import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TOUR_SLIDES, type TourArea } from './lib/tour.ts';

interface Props {
  /** Called once the dialog has closed, by any of its buttons or Esc. */
  onClose: () => void;
}

/**
 * The onboarding slides (build-plan §15): a modal over the simulator, mounted while
 * open, so each opening starts at the first slide. Every way out goes through the
 * dialog's own close, which returns focus to where it was.
 */
export function Tour({ onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(0);
  const slide = TOUR_SLIDES[index];
  const last = index === TOUR_SLIDES.length - 1;

  useEffect(() => {
    const element = dialog.current;
    // No close in a cleanup: StrictMode's second mount would end the tour.
    if (element && !element.open) {
      element.showModal();
      next.current?.focus();
    }
  }, []);
  // Back is disabled on the first slide and Skip is hidden on the last; focus held
  // there would fall out of the dialog. A hidden Skip is still mounted and enabled,
  // so it is named here: the browser moves focus off it only later, to the page.
  useEffect(() => {
    const active = document.activeElement;
    const stranded =
      !dialog.current?.contains(active) ||
      (active instanceof HTMLButtonElement && active.disabled) ||
      (last && active === skip.current);
    if (stranded) next.current?.focus();
  }, [index, last]);

  const close = () => dialog.current?.close();
  const go = (to: number) => setIndex(Math.max(0, Math.min(TOUR_SLIDES.length - 1, to)));
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight') go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else return;
    event.preventDefault();
  }

  return (
    <dialog ref={dialog} className="tour" aria-labelledby="tour-name tour-title" aria-describedby="tour-lines" onClose={onClose} onKeyDown={onKeyDown}>
      <div className="tour-head">
        <h2 id="tour-name">Onboarding</h2>
        {/* Hidden, not removed, on the last slide, so the title row keeps its height. */}
        <button type="button" className="tour-skip" ref={skip} style={last ? { visibility: 'hidden' } : undefined} onClick={close}>
          Skip
        </button>
      </div>
      <TourMap areas={slide.areas} />
      {/* Announces the new slide; the dialog's label and description are read only when it opens. */}
      <div aria-live="polite">
        <div className="tour-title-row">
          <h3 id="tour-title">{slide.title}</h3>
          <p className="tour-step">
            {index + 1} / {TOUR_SLIDES.length}
          </p>
        </div>
        <div id="tour-lines" className="tour-lines">
          {slide.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
      <div className="tour-actions">
        <button type="button" disabled={index === 0} onClick={() => go(index - 1)}>
          Back
        </button>
        <button type="button" className="primary" ref={next} onClick={last ? close : () => go(index + 1)}>
          {last ? 'Start texting' : 'Next'}
        </button>
      </div>
    </dialog>
  );
}

/**
 * A coarse drawing of the simulator (header, customer and Dave panels, the switch
 * between them, the judgment log) with the slide's areas highlighted. Decorative:
 * the slide's text says the same.
 */
function TourMap({ areas }: { areas: readonly TourArea[] }) {
  const area = (name: TourArea) => `area${areas.includes(name) ? ' on' : ''}`;
  return (
    <svg className={`tour-map${areas.length ? ' focused' : ''}`} viewBox="0 0 320 184" aria-hidden="true">
      <g className={area('header')}>
        <rect className="frame" x="4" y="4" width="312" height="16" rx="4" />
        <text x="11" y="14.5" className="label strong">
          Dave's Lawn Desk
        </text>
        <rect className="mark" x="82" y="9" width="20" height="6" rx="3" />
        <rect className="mark" x="196" y="9.5" width="30" height="5" rx="2" />
        <rect className="mark" x="232" y="9" width="24" height="6" rx="3" />
        <rect className="mark" x="262" y="9.5" width="48" height="5" rx="2" />
      </g>

      <rect className="panel" x="4" y="26" width="146" height="136" rx="6" />
      <text x="11" y="34.5" className="label">
        Customer
      </text>
      <g className={area('phone')}>
        <rect className="frame" x="12" y="42" width="50" height="112" rx="7" />
        <rect className="mark" x="17" y="56" width="30" height="7" rx="3" />
        <rect className="mark them" x="27" y="68" width="30" height="11" rx="3" />
        <rect className="mark" x="17" y="84" width="26" height="7" rx="3" />
        <rect className="mark" x="16" y="143" width="42" height="7" rx="3" />
      </g>
      <g className={area('card')}>
        <rect className="frame" x="70" y="42" width="72" height="44" rx="4" />
        <rect className="mark" x="75" y="48" width="26" height="4" rx="2" />
        <rect className="mark" x="75" y="57" width="34" height="3" rx="1.5" />
        <rect className="mark" x="75" y="64" width="34" height="3" rx="1.5" />
        <rect className="mark" x="75" y="71" width="34" height="3" rx="1.5" />
        <rect className="mark map" x="114" y="48" width="23" height="32" rx="3" />
      </g>
      <g className={area('replies')}>
        <rect className="frame" x="70" y="92" width="72" height="28" rx="4" />
        <rect className="mark" x="75" y="98" width="42" height="5" rx="2.5" />
        <rect className="mark" x="75" y="107" width="54" height="5" rx="2.5" />
      </g>
      <g className={area('status')}>
        <rect className="frame" x="70" y="126" width="72" height="28" rx="4" />
        <rect className="mark" x="75" y="132" width="30" height="4" rx="2" />
        <rect className="mark" x="75" y="141" width="52" height="3" rx="1.5" />
      </g>

      <g className={area('switcher')}>
        <rect className="frame" x="154" y="72" width="12" height="44" rx="3" />
        <rect className="mark" x="156" y="76" width="8" height="10" rx="2" />
        <rect className="mark" x="156" y="89" width="8" height="10" rx="2" />
        <rect className="mark" x="156" y="102" width="8" height="10" rx="2" />
      </g>

      <rect className="panel" x="170" y="26" width="146" height="136" rx="6" />
      <text x="177" y="34.5" className="label">
        Dave
      </text>
      <g className={area('sync')}>
        <rect className="frame" x="196" y="29" width="22" height="7" rx="3.5" />
      </g>
      <g className={area('calendar')}>
        <rect className="frame" x="178" y="42" width="130" height="66" rx="4" />
        {[0, 1, 2, 3, 4, 5].map((column) => (
          <line key={column} className="grid" x1={196.6 + column * 18.6} y1="46" x2={196.6 + column * 18.6} y2="104" />
        ))}
        <rect className="mark them" x="181" y="54" width="13" height="14" rx="2" />
        <rect className="mark them" x="218" y="70" width="13" height="10" rx="2" />
        <rect className="mark booked" x="236" y="52" width="13" height="16" rx="2" />
        <rect className="mark them" x="273" y="82" width="13" height="14" rx="2" />
      </g>
      <g className={area('facts')}>
        <rect className="frame" x="178" y="114" width="62" height="30" rx="4" />
        <rect className="frame" x="246" y="114" width="40" height="30" rx="4" />
        <rect className="mark" x="183" y="120" width="30" height="3" rx="1.5" />
        <rect className="mark" x="183" y="127" width="48" height="3" rx="1.5" />
        <rect className="mark" x="183" y="134" width="48" height="3" rx="1.5" />
        <rect className="mark" x="251" y="120" width="22" height="3" rx="1.5" />
        <rect className="mark" x="251" y="127" width="30" height="3" rx="1.5" />
        <rect className="mark" x="251" y="134" width="30" height="3" rx="1.5" />
      </g>
      <g className={area('dave-phone')}>
        <circle className="frame" cx="302" cy="150" r="8" />
        <rect className="mark" x="299" y="145.5" width="6" height="9" rx="1.5" />
      </g>

      <g className={area('log')}>
        <rect className="frame" x="4" y="168" width="312" height="12" rx="4" />
        <text x="11" y="176.5" className="label">
          Judgment log
        </text>
      </g>
    </svg>
  );
}
