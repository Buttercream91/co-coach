// Mirror of server/src/domain/formations.ts. Keep in sync.
import type { Formation } from '../types';

function row(y: number, count: number, startSlot: number, prefix: string) {
  const positions = [];
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

function build(lines: { count: number; y: number; prefix: string }[]) {
  let slot = 0;
  const out = [];
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

export const SUPPORTED_PLAYER_COUNTS = Object.keys(FORMATIONS_BY_PLAYER_COUNT)
  .map((n) => Number(n))
  .sort((a, b) => a - b);

export function formationsFor(playerCount: number): Formation[] {
  return FORMATIONS_BY_PLAYER_COUNT[playerCount] ?? [];
}

export function formationByName(playerCount: number, name: string): Formation | undefined {
  return formationsFor(playerCount).find((f) => f.name === name);
}
