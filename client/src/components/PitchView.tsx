import type { FormationPosition } from '../types';

// Renders the pitch as an SVG and positions jersey-image-based tiles using
// each formation slot's normalised (x, y) coordinates. The pitch is drawn
// defence-at-bottom, attack-at-top.

export type JerseySlot = {
  position: FormationPosition;
  player: { id: string; name: string; jerseyNumber: number | null } | null;
  highlightColor?: string;
  selected?: boolean;
  onClick?: () => void;
};

export function PitchView({
  goalie,
  goalieSelected,
  goalieHighlightColor,
  onGoalieClick,
  slots,
  goalieReadOnly,
}: {
  goalie: { id: string; name: string; jerseyNumber: number | null } | null;
  goalieSelected?: boolean;
  goalieHighlightColor?: string;
  onGoalieClick?: () => void;
  slots: JerseySlot[];
  goalieReadOnly?: boolean;
}) {
  return (
    <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden select-none">
      <PitchBackground />

      <SlotPositioned x={0.5} y={0.05}>
        <Jersey
          player={goalie}
          label="GK"
          isGoalie
          selected={goalieSelected}
          highlightColor={goalieHighlightColor}
          onClick={goalieReadOnly ? undefined : onGoalieClick}
          disabledHint={goalieReadOnly ? 'Change goalie in match settings' : undefined}
        />
      </SlotPositioned>

      {slots.map((s) => (
        <SlotPositioned key={s.position.slot} x={s.position.x} y={s.position.y}>
          <Jersey
            player={s.player}
            label={s.position.label}
            onClick={s.onClick}
            highlightColor={s.highlightColor}
            selected={s.selected}
          />
        </SlotPositioned>
      ))}
    </div>
  );
}

function PitchBackground() {
  return (
    <svg
      viewBox="0 0 100 130"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <pattern id="stripes" width="100" height="13" patternUnits="userSpaceOnUse">
          <rect width="100" height="13" fill="#3a8a3a" />
          <rect width="100" height="6.5" fill="#4ea24e" />
        </pattern>
      </defs>
      <rect width="100" height="130" fill="url(#stripes)" />
      <rect x="2" y="2" width="96" height="126" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
      <line x1="2" y1="65" x2="98" y2="65" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
      <circle cx="50" cy="65" r="11" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
      <circle cx="50" cy="65" r="1" fill="white" fillOpacity="0.85" />
      <rect x="22" y="110" width="56" height="18" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
      <rect x="36" y="122" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
      <rect x="22" y="2" width="56" height="18" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
      <rect x="36" y="2" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.7" />
    </svg>
  );
}

function SlotPositioned({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  const top = (1 - y) * 100;
  const left = x * 100;
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ top: `${top}%`, left: `${left}%` }}
    >
      {children}
    </div>
  );
}

const SUB_COLOR_CLASSES = [
  'ring-rose-400',
  'ring-sky-400',
  'ring-amber-400',
  'ring-fuchsia-400',
  'ring-lime-400',
  'ring-orange-400',
  'ring-violet-400',
];

export function subColorClass(idx: number | undefined): string | undefined {
  if (idx === undefined) return undefined;
  return SUB_COLOR_CLASSES[idx % SUB_COLOR_CLASSES.length];
}

export function Jersey({
  player,
  label,
  onClick,
  highlightColor,
  selected,
  isGoalie,
  disabledHint,
}: {
  player: { id: string; name: string; jerseyNumber: number | null } | null;
  label: string;
  onClick?: () => void;
  highlightColor?: string;
  selected?: boolean;
  isGoalie?: boolean;
  disabledHint?: string;
}) {
  const filled = !!player;
  // Selection uses a square white outline so it's clearly different from the
  // circular coloured sub-pair rings.
  const ringClasses: string[] = [];
  if (selected) {
    ringClasses.push('outline outline-4 outline-white outline-offset-2');
  } else if (highlightColor) {
    ringClasses.push('rounded-full ring-4', highlightColor);
  } else {
    ringClasses.push('rounded-full');
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={disabledHint}
      aria-label={player ? player.name : `Empty ${label}`}
      className={`flex flex-col items-center group ${onClick ? '' : 'cursor-default'}`}
    >
      <span
        className={`relative w-16 h-20 flex items-center justify-center group-active:scale-95 transition ${ringClasses.join(' ')}`}
        style={{
          filter: isGoalie ? 'hue-rotate(180deg) saturate(1.3)' : undefined,
        }}
      >
        <img
          src="/jersey.png"
          alt=""
          className={`absolute inset-0 w-full h-full object-contain ${filled ? '' : 'opacity-40'}`}
          aria-hidden="true"
        />
        <span
          className={`relative z-10 ${filled ? 'text-white' : 'text-slate-100/60'} text-lg font-bold`}
          style={{
            textShadow: filled ? '0 1px 2px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.6)' : undefined,
          }}
        >
          {filled ? (player.jerseyNumber ?? '') : '+'}
        </span>
      </span>
      <span className="mt-1 max-w-[96px] text-[11px] leading-tight text-white text-center drop-shadow font-semibold truncate">
        {player ? player.name : label}
      </span>
    </button>
  );
}
