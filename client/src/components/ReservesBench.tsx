import type { Player } from '../types';

// A horizontal scrollable bench of jerseys. Same visual language as the pitch
// tiles (jersey image with number overlay) plus optional sub-pair highlight
// and selection ring.

export function ReservesBench({
  reserves,
  highlightColors,
  selectedPlayerId,
  onPlayerClick,
  title = 'Reserves',
  emptyText = 'No reserves this segment.',
  tone = 'normal',
  readOnly = false,
}: {
  reserves: Player[];
  highlightColors: Record<string, string | undefined>;
  selectedPlayerId: string | null;
  onPlayerClick: (playerId: string) => void;
  title?: string;
  emptyText?: string;
  tone?: 'normal' | 'sickbay';
  readOnly?: boolean;
}) {
  const isSickbay = tone === 'sickbay';
  return (
    <div
      className={`rounded-lg border p-3 ${
        isSickbay
          ? 'border-rose-200 bg-rose-50'
          : readOnly
          ? 'border-slate-200 bg-slate-100/60'
          : 'border-slate-200 bg-slate-50'
      }`}
    >
      <div
        className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
          isSickbay ? 'text-rose-700' : readOnly ? 'text-slate-500' : 'text-slate-600'
        }`}
      >
        {title} ({reserves.length})
      </div>
      {reserves.length === 0 ? (
        <div className="text-xs text-slate-500">{emptyText}</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {reserves.map((p) => (
            <li key={p.id}>
              <BenchJersey
                player={p}
                onClick={() => onPlayerClick(p.id)}
                selected={!readOnly && p.id === selectedPlayerId}
                highlightColor={readOnly ? undefined : highlightColors[p.id]}
                sickbay={isSickbay}
                readOnly={readOnly}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BenchJersey({
  player,
  onClick,
  selected,
  highlightColor,
  sickbay,
  readOnly = false,
}: {
  player: Player;
  onClick: () => void;
  selected: boolean;
  highlightColor?: string;
  sickbay?: boolean;
  readOnly?: boolean;
}) {
  // Selection: square white outline (distinct from circular colour rings).
  // Sub-pair colour or sick-bay tint stay as circular rings.
  let containerClasses: string;
  if (selected) {
    containerClasses = 'outline outline-4 outline-white outline-offset-2';
  } else if (highlightColor) {
    containerClasses = `rounded-full ring-4 ${highlightColor}`;
  } else if (sickbay) {
    containerClasses = 'rounded-full ring-2 ring-rose-300';
  } else {
    containerClasses = 'rounded-full';
  }

  return (
    <button
      type="button"
      onClick={readOnly ? undefined : onClick}
      disabled={readOnly}
      className={`flex flex-col items-center min-w-[72px] ${readOnly ? 'opacity-70 cursor-default' : ''}`}
    >
      <span className={`relative w-14 h-16 flex items-center justify-center ${containerClasses}`}>
        <img
          src="/jersey.png"
          alt=""
          className={`absolute inset-0 w-full h-full object-contain ${sickbay ? 'grayscale opacity-80' : ''}`}
        />
        <span
          className="relative z-10 text-white text-base font-bold"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          {player.jerseyNumber ?? ''}
        </span>
      </span>
      <span className="mt-1 text-[10px] leading-tight text-slate-800 font-medium text-center max-w-[80px] truncate">
        {player.name}
      </span>
    </button>
  );
}
