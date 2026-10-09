import type { Paint, Palette } from "./ansi.js";
import {
  groupNumber,
  rankContext,
  resampleHistory,
  riseLabel,
  standing,
  type HistoryPoint,
} from "./derive.js";

/**
 * The Terminal share graphic, as terminal output.
 *
 * Same lines, same order, same arithmetic as the graphic on domainrating.lol
 * (components/share-graphics/designs/terminal.tsx, the wide layout): the
 * status line, the rating in a 5 × 7 pixel face, the key/value block beside
 * it, and the caption under the pixels. Narrow terminals get the pixels
 * stacked above the block, and very narrow ones the block alone.
 */

/** What `GET /api/drcheck` answers with. */
export type DrcheckResult = {
  domain: string;
  created: boolean;
  listing: {
    slug: string;
    url: string;
    locked: boolean;
    claimable: boolean;
  };
  rating: {
    dr: number;
    drLabel: string;
    rank: number;
    total: number;
    category: string | null;
    measuredOn: string;
    history: HistoryPoint[];
    change: { delta: number; since: string } | null;
  } | null;
};

/** A 5 × 7 bitmap face for the rating: digits and the decimal point. */
export const GLYPHS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
};

/** How big the pixel face is drawn: 1 everywhere, 2 in `--full` when the
 *  screen has room for it. */
export type Scale = 1 | 2;

/**
 * One pixel, row by row. At 1 it is two columns holding a square drawn by
 * the lower-right and lower-left quadrants, so every cell is a square with a
 * gap around it, like the art's, and neighbours never merge into one block.
 * At 2 it is four columns by two rows, the same square with half a column and
 * half a row of air, which brings the gaps closer to the art's. Quadrants and
 * half blocks are block elements, which terminals draw themselves rather than
 * take from the font, so the square is the same size everywhere.
 */
const CELLS: Record<Scale, readonly string[]> = {
  1: ["▗▖"],
  2: ["▗▄▄▖", "▐██▌"],
};
/**
 * The 1× pixel where the terminal draws sextants itself: the lower two thirds
 * of a column and a half. In a terminal's usual cell shape that is a square
 * too, with half the gap the quadrants leave, closer to the art's.
 */
const SEXTANT_CELL = "\u{1FB39}\u{1FB13}";
/** A pixel's columns, whichever characters draw it. */
const CELL_COLUMNS: Record<Scale, number> = { 1: 2, 2: 4 };

function cellRows(scale: Scale, p: Palette): readonly string[] {
  return scale === 1 && p.sextants ? [SEXTANT_CELL] : CELLS[scale];
}
/** Between the pixels and the left edge. */
const PAD = "  ";
/** Between two glyphs: with the half column of air inside each cell, a gap
 *  one cell wide, like the art's. */
const GLYPH_GAPS: Record<Scale, string> = { 1: " ", 2: "   " };
/** The block's key column: the longest key and three spaces, like the art. */
const KEY_WIDTH = 11;
/** Between the pixels and the block. */
const GUTTER = 4;
/** The wide graphic's meter and sparkline lengths. */
const METER_CELLS = 14;
const SPARK_BARS = 12;
const SPARK = "▁▂▃▄▅▆▇█";
const CAPTION = "Domain Rating, out of 100";

type Segment = { text: string; paint?: Paint };

function width(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + [...segment.text].length, 0);
}

function draw(segments: readonly Segment[]): string {
  return segments
    .map((segment) =>
      segment.paint ? segment.paint(segment.text) : segment.text,
    )
    .join("");
}

/** Cut a line to `max` columns, ending it in an ellipsis like the art does. */
export function fit(segments: readonly Segment[], max: number): Segment[] {
  if (width(segments) <= max) return [...segments];
  const out: Segment[] = [];
  let room = Math.max(0, max - 1);
  for (const segment of segments) {
    if (room <= 0) break;
    const chars = [...segment.text];
    out.push({ ...segment, text: chars.slice(0, room).join("") });
    room -= Math.min(room, chars.length);
  }
  out.push({ text: "…" });
  return out;
}

/** Neighbouring runs of the same paint as one escape sequence. */
function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.paint === segment.paint) last.text += segment.text;
    else out.push({ ...segment });
  }
  return out;
}

/** The rating in the pixel face: seven rows of cells, padded on the left. */
export function pixels(
  label: string,
  p: Palette,
  scale: Scale = 1,
): Segment[][] {
  const glyphs = [...label].map((char) => GLYPHS[char] ?? GLYPHS["0"]!);
  return Array.from({ length: 7 }, (_, y) =>
    cellRows(scale, p).map((cell) =>
      merge(
        glyphs.flatMap((rows, index) => [
          { text: index > 0 ? GLYPH_GAPS[scale] : PAD },
          ...[...rows[y]!].map((on) =>
            on === "1"
              ? { text: cell, paint: p.accent }
              : // Without colour an unlit cell would print as a lit one,
                // so it is blank.
                {
                  text: p.level === 0 ? " ".repeat(CELL_COLUMNS[scale]) : cell,
                  paint: p.off,
                },
          ),
        ]),
      ),
    ),
  ).flat();
}

/** The columns the pixel face takes, its left padding included. */
export function pixelWidth(label: string, scale: Scale = 1): number {
  const glyphs = [...label].map((char) => GLYPHS[char] ?? GLYPHS["0"]!);
  const cells = glyphs.reduce((sum, rows) => sum + rows[0]!.length, 0);
  return (
    PAD.length +
    cells * CELL_COLUMNS[scale] +
    Math.max(0, glyphs.length - 1) * GLYPH_GAPS[scale].length
  );
}

/** The narrowest terminal that fits the pixels beside the block. */
export function sideBySideColumns(label: string, scale: Scale = 1): number {
  // A row ending in the last column wraps in some terminals, so every layout
  // keeps one column free.
  return pixelWidth(label, scale) + GUTTER + KEY_WIDTH + 20 + 1;
}

/** A history worth drawing: one that moved. A rating that read the same
 *  every day would only print a flat bar. */
export function hasHistory(history: readonly HistoryPoint[]): boolean {
  return new Set(history.map((point) => point.dr)).size > 1;
}

/** The rating out of 100, as cells: the art's bar beside the number. */
export function meter(dr: number, cells: number, p: Palette): Segment[] {
  const filled = Math.round((Math.min(Math.max(dr, 0), 100) / 100) * cells);
  return p.level === 0
    ? [{ text: "█".repeat(filled) + "░".repeat(cells - filled) }]
    : [
        { text: "▌".repeat(filled), paint: p.accent },
        { text: "▌".repeat(cells - filled), paint: p.dim },
      ];
}

/**
 * The whole history as bars, scaled the way the art scales them: 15% of the
 * height for the lowest reading, 90% for the highest, 45% when flat.
 */
export function sparkline(
  history: readonly HistoryPoint[],
  count: number,
): string {
  const values = resampleHistory(history, count);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return values
    .map((value) => {
      const share =
        high === low ? 0.45 : 0.15 + ((value - low) / (high - low)) * 0.75;
      const level = Math.min(8, Math.max(1, Math.round((share / 0.9) * 8)));
      return SPARK[level - 1];
    })
    .join("");
}

type Line = { key: string; value: Segment[] };

function block(result: DrcheckResult, p: Palette): Line[] {
  const lines: Line[] = [
    { key: "domain", value: [{ text: result.domain, paint: p.strong }] },
  ];
  const rating = result.rating;
  if (!rating) return lines;
  const { topPercent } = standing(rating.rank, rating.total);
  const rise = riseLabel(rating.change);
  lines.push(
    {
      key: "rating",
      value: [
        { text: rating.drLabel, paint: p.strong },
        { text: "/100  " },
        ...meter(rating.dr, METER_CELLS, p),
      ],
    },
    {
      key: "rank",
      value: [
        {
          text: `#${groupNumber(rating.rank)} ${rankContext(rating.rank, rating.total)}`,
        },
      ],
    },
  );
  if (topPercent !== null)
    lines.push({ key: "standing", value: [{ text: `top ${topPercent}%` }] });
  lines.push({ key: "category", value: [{ text: rating.category ?? "none" }] });
  if (hasHistory(rating.history))
    lines.push({
      key: "history",
      value: [
        { text: sparkline(rating.history, SPARK_BARS), paint: p.spark },
        ...(rise ? [{ text: `  ${rise}`, paint: p.good }] : []),
      ],
    });
  lines.push({ key: "measured", value: [{ text: rating.measuredOn }] });
  return lines;
}

function keyed(line: Line, p: Palette, room: number): string {
  return (
    p.key(line.key.padEnd(KEY_WIDTH)) +
    draw(fit(line.value, Math.max(1, room - KEY_WIDTH)))
  );
}

/** What the CLI prints under the block: where to claim or unlock it. */
function footer(result: DrcheckResult, p: Palette): string[] {
  const { locked, claimable, url } = result.listing;
  const lead = locked
    ? `Locked: blurred card, nofollow link. ${claimable ? "Claim and unlock it" : "Unlock it"} at`
    : claimable
      ? "Nobody has claimed this listing yet. Claim it at"
      : null;
  if (!lead) return [];
  return ["", `${p.accent("→")} ${lead}`, `  ${p.link(url)}`];
}

export interface RenderOptions {
  /** Terminal columns. */
  width: number;
  palette: Palette;
  scale?: Scale;
}

/** The whole output, as lines, without a trailing newline. */
export function render(
  result: DrcheckResult,
  options: RenderOptions,
): string[] {
  const p = options.palette;
  const columns = Math.max(20, options.width);
  const out: string[] = [];
  const lines = block(result, p);

  if (!result.rating) {
    out.push(
      `${p.bad("✗")} ${p.muted("Domain Rating not available from Ahrefs yet")}`,
      "",
      ...lines.map((line) => keyed(line, p, columns - 1)),
    );
    return [...out, ...footer(result, p)];
  }

  out.push(`${p.good("✓")} ${p.muted("Domain Rating read from Ahrefs")}`, "");

  const label = result.rating.drLabel;
  const scale = options.scale ?? 1;
  const pixelCols = pixelWidth(label, scale);
  const rows = pixels(label, p, scale).map(draw);
  // Under the pixels and aligned with them, cut to fit like any other line.
  const caption = (room: number) =>
    draw(fit([{ text: PAD + CAPTION, paint: p.key }], room));
  const sideBySide = columns >= sideBySideColumns(label, scale);

  if (sideBySide) {
    const room = columns - 1 - pixelCols - GUTTER;
    const height = Math.max(rows.length, lines.length);
    // Level with the top of the pixels, like the art; beside the taller
    // double-size face the block sits in the middle instead.
    const offset =
      scale === 2
        ? Math.max(0, Math.floor((rows.length - lines.length) / 2))
        : 0;
    for (let i = 0; i < height; i += 1) {
      const left = rows[i] ?? " ".repeat(pixelCols);
      const line = lines[i - offset];
      out.push(line ? left + " ".repeat(GUTTER) + keyed(line, p, room) : left);
    }
    out.push(caption(columns - 1));
  } else {
    if (columns - 1 >= pixelCols) out.push(...rows, caption(columns - 1), "");
    out.push(...lines.map((line) => keyed(line, p, columns - 1)));
  }
  return [...out, ...footer(result, p)];
}
