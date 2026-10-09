/**
 * The arithmetic The Terminal share graphic does on a listing's figures,
 * ported line for line from domainrating.lol (lib/share-graphics/derive.ts)
 * so the CLI prints exactly what the graphic draws.
 *
 * Nothing here makes a number up: a percentile is rank over total, and the
 * sparkline is the stored readings resampled onto a time axis.
 */

/** One stored reading: the UTC day and the rating that day. */
export type HistoryPoint = { on: string; dr: number };

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function groupNumber(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Where the listing stands on the ranking, said the kindest true way. A
 * "top N%" is only offered in the top half, where it flatters.
 */
export function standing(rank: number, total: number) {
  const share = total > 0 ? rank / total : 1;
  return {
    topPercent:
      total >= 10 && share <= 0.5 ? Math.max(1, Math.ceil(share * 100)) : null,
    outranks: Math.max(0, total - rank),
  };
}

/** "of 1,284 sites" in the top half, "on the ranking" below it. */
export function rankContext(rank: number, total: number): string {
  return total > 0 && rank / total <= 0.5
    ? `of ${groupNumber(total)} sites`
    : "on the ranking";
}

/** "+5 since Sep 22", only when the rating actually went up. */
export function riseLabel(
  change: { delta: number; since: string } | null,
): string | null {
  if (!change || !(change.delta > 0)) return null;
  const [, m, d] = change.since.split("-").map(Number);
  return `+${change.delta} since ${MONTHS[(m || 1) - 1]} ${d}`;
}

function dayTime(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * The rating at `count` evenly spaced moments from the first reading to the
 * last, each the latest reading on or before it. A single reading is held
 * flat.
 */
export function resampleHistory(
  history: readonly HistoryPoint[],
  count: number,
): number[] {
  const last = history[history.length - 1];
  if (!last) return Array.from({ length: count }, () => 0);
  const first = dayTime(history[0]!.on);
  const span = dayTime(last.on) - first;
  if (history.length === 1 || span <= 0 || count <= 1)
    return Array.from({ length: count }, () => last.dr);
  let at = 0;
  return Array.from({ length: count }, (_, i) => {
    const t = first + (i / (count - 1)) * span;
    while (at + 1 < history.length && dayTime(history[at + 1]!.on) <= t)
      at += 1;
    return history[at]!.dr;
  });
}
