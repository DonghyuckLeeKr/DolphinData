// Splits the dashboard cards into two columns of similar height. Real heights are measured
// in the app; these estimates (default 1120px window, desktop app) cover the first render.
const ESTIMATED_HEIGHTS = {
  'network-state': 250,
  traffic: 285,
  speed: 215,
  ping: 170,
  processes: 600
};

// Reading order inside each column follows this list regardless of which column a card lands in.
const CANONICAL_ORDER = ['network-state', 'traffic', 'speed', 'ping', 'processes'];

const heightOf = (id, heights) => heights[id] ?? ESTIMATED_HEIGHTS[id] ?? 200;

export const balanceDashboardColumns = (cardIds, heights = {}) => {
  const rank = id => CANONICAL_ORDER.indexOf(id);
  const ids = [...cardIds].sort((a, b) => rank(a) - rank(b));
  if (ids.length < 2) return ids.length ? [ids] : [];
  // At most five cards, so every split can be checked. The first card in reading order
  // (usually the live traffic chart) stays in the left column.
  let best = null;
  for (let mask = 0; mask < 1 << (ids.length - 1); mask++) {
    const left = [ids[0]];
    const right = [];
    ids.slice(1).forEach((id, index) => ((mask >> index) & 1 ? right : left).push(id));
    if (right.length === 0) continue;
    const imbalance = columnImbalance([left, right], heights);
    if (!best || imbalance < best.imbalance) best = { imbalance, columns: [left, right] };
  }
  return best.columns;
};

export const columnImbalance = (columns, heights = {}) => {
  const totals = columns.map(ids => ids.reduce((sum, id) => sum + heightOf(id, heights), 0));
  return totals.length < 2 ? 0 : Math.abs(totals[0] - totals[1]);
};

// Moving a card remounts it, so keep the current split unless the new one is clearly better.
export const REBALANCE_THRESHOLD = 80;

export const chooseDashboardColumns = (cardIds, heights, previous) => {
  const candidate = balanceDashboardColumns(cardIds, heights);
  const sameCards = previous
    && previous.flat().length === cardIds.length
    && cardIds.every(id => previous.flat().includes(id));
  if (!sameCards) return candidate;
  return columnImbalance(previous, heights) - columnImbalance(candidate, heights) >= REBALANCE_THRESHOLD
    ? candidate
    : previous;
};
