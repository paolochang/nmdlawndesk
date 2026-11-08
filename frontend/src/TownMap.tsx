import { townDays, townGroup, type DaveConfig } from './lib/config.ts';
import type { Focus } from './lib/layout.ts';
import { mapCaption, ROADS, TOWN_POSITIONS, townMap } from './lib/town-map.ts';

interface Props {
  focus: Focus;
  customer: { street: string; town: string };
  config: DaveConfig | undefined;
}

// A fictional map of every town (build-plan §7), the customer's own marked "You".
// Once Dave's side is open, the towns take his weekday colours.
export function TownMap({ focus, customer, config }: Props) {
  const view = townMap(focus, customer.town, config);
  return (
    <figure className="town-map">
      <h3>Your location</h3>
      <svg viewBox="0 0 320 214" role="img" aria-label={`Map of the towns; the customer lives in ${customer.town}`}>
        {ROADS.map(([from, to]) => {
          const a = TOWN_POSITIONS[from];
          const b = TOWN_POSITIONS[to];
          return <path key={`${from}-${to}`} className="road" d={`M${a.x} ${a.y} L${b.x} ${b.y}`} />;
        })}
        {view.markers.map((marker) => {
          const right = marker.x > 240;
          const outside = view.daveView && config !== undefined && townGroup(config, marker.town) === undefined;
          return (
            <g key={marker.town} className={`town${marker.customer ? ' here' : ''}${outside ? ' outside' : ''}`}>
              {marker.customer && (
                <>
                  <circle className="ring" cx={marker.x} cy={marker.y} r="13" />
                  <text className="you" x={marker.x} y={marker.y - 19} textAnchor="middle">
                    You
                  </text>
                </>
              )}
              <circle cx={marker.x} cy={marker.y} r="6" fill={marker.color} />
              <text x={right ? marker.x - 11 : marker.x + 11} y={marker.y + 4} textAnchor={right ? 'end' : 'start'}>
                {marker.town}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="hint">{mapCaption(customer, config, view.daveView)}</figcaption>
      {view.daveView && config && (
        <ul className="legend">
          {townDays(config).map((group) => (
            <li key={group.days}>
              <i style={{ background: group.color }} aria-hidden="true" />
              {group.days}
            </li>
          ))}
          <li>
            <i className="outside" aria-hidden="true" />
            Not Dave's town
          </li>
        </ul>
      )}
    </figure>
  );
}
