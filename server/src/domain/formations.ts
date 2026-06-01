// Single source of truth for the formations the coach can pick.
//
// Coordinates are normalised to a unit pitch where (0,0) = top-left of our
// team's defensive third (goalie area), (1,1) = top-right of the attacking
// third (striker area). The pitch SVG translates these to pixel coords.
//
// `slot` is the stable index used in segment_positions.position_slot. NEVER
// reuse a slot index across formations within a player count — always append.

export type Position = {
  slot: number;
  label: string; // short tag for the position, e.g. 'LB', 'CM', 'ST'
  x: number; // 0..1, side-to-side
  y: number; // 0..1, defence (0) → attack (1)
};

export type Formation = {
  name: string; // e.g. '4-3-1'
  positions: Position[]; // length = playerCount - 1 (no goalie slot here)
};

// 9-player formations (goalie excluded). Order = defence first, striker last.
// Lines are evenly spaced across the X axis within a row.
function row(y: number, count: number, startSlot: number, prefix: string): Position[] {
  // Spread N positions evenly along x, padded inward from edges.
  const positions: Position[] = [];
  const pad = 0.1;
  const step = count > 1 ? (1 - 2 * pad) / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0.5 : pad + step * i;
    positions.push({
      slot: startSlot + i,
      label: `${prefix}${count > 1 ? i + 1 : ''}`,
      x,
      y,
    });
  }
  return positions;
}

function build(lines: { count: number; y: number; prefix: string }[]): Formation['positions'] {
  let slot = 0;
  const out: Position[] = [];
  for (const line of lines) {
    out.push(...row(line.y, line.count, slot, line.prefix));
    slot += line.count;
  }
  return out;
}

const NINE_PLAYER: Formation[] = [
  {
    name: '4-3-1',
    positions: build([
      { count: 4, y: 0.18, prefix: 'D' },
      { count: 3, y: 0.5, prefix: 'M' },
      { count: 1, y: 0.85, prefix: 'ST' },
    ]),
  },
  {
    name: '4-2-2',
    positions: build([
      { count: 4, y: 0.18, prefix: 'D' },
      { count: 2, y: 0.5, prefix: 'M' },
      { count: 2, y: 0.85, prefix: 'F' },
    ]),
  },
  {
    name: '3-4-1',
    positions: build([
      { count: 3, y: 0.18, prefix: 'D' },
      { count: 4, y: 0.5, prefix: 'M' },
      { count: 1, y: 0.85, prefix: 'ST' },
    ]),
  },
  {
    name: '3-3-2',
    positions: build([
      { count: 3, y: 0.18, prefix: 'D' },
      { count: 3, y: 0.5, prefix: 'M' },
      { count: 2, y: 0.85, prefix: 'F' },
    ]),
  },
];

export const FORMATIONS_BY_PLAYER_COUNT: Record<number, Formation[]> = {
  9: NINE_PLAYER,
};

export function isValidFormation(playerCount: number, name: string): boolean {
  return (FORMATIONS_BY_PLAYER_COUNT[playerCount] ?? []).some((f) => f.name === name);
}
