import { OUTSIDE_COLOR, townDays, type DaveConfig } from './lib/config.ts';
import type { Focus } from './lib/layout.ts';
import { townMap } from './lib/town-map.ts';

interface Props {
  focus: Focus;
  customerTown: string;
  config: DaveConfig | undefined;
}

// A fictional map of every town (build-plan §7), the customer's own marked. Once
// Dave's side is open, the towns take his weekday colours.
export function TownMap({ focus, customerTown, config }: Props) {
  const view = townMap(focus, customerTown, config);
  return (
    <figure className="town-map">
      <svg viewBox="0 0 320 200" role="img" aria-label={`Map of the towns; the customer lives in ${customerTown}`}>
        <rect className="land" x="0" y="0" width="320" height="200" rx="10" />
        <path className="river" d="M262 0 C246 52 268 92 252 128 C238 160 254 184 248 200" />
        <path className="road" d="M20 100 H300 M156 10 V190" />
        {view.daveView && <rect className="area" x="78" y="28" width="164" height="142" rx="22" />}
        {view.markers.map((marker) => (
          <g key={marker.town} className={marker.customer ? 'town customer' : 'town'}>
            {marker.customer && <circle cx={marker.x} cy={marker.y} r="12" className="halo" />}
            <circle cx={marker.x} cy={marker.y} r="6" fill={marker.color} />
            <text x={marker.x} y={marker.y - 13} textAnchor="middle">
              {marker.town}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        <ul className="legend">
          <li>
            <i className="you" aria-hidden="true" />
            This customer
          </li>
          {view.daveView && config ? (
            <>
              {townDays(config).map((group) => (
                <li key={group.days}>
                  <i style={{ background: group.color }} aria-hidden="true" />
                  {group.days}
                </li>
              ))}
              <li>
                <i style={{ background: OUTSIDE_COLOR }} aria-hidden="true" />
                Outside Dave's area
              </li>
            </>
          ) : (
            <li>Open Dave's side to see his days</li>
          )}
        </ul>
      </figcaption>
    </figure>
  );
}
