/**
 * Colour, decided once per run from the environment.
 *
 * The palette is the share graphic's: indigo for the rating, green for a
 * rise, zinc greys for labels. Values are left in the terminal's own
 * foreground, so the output reads on a light background as well as a dark
 * one; only the faint "off" pixels and empty meter cells change with it.
 */

export type Paint = (text: string) => string;

export type ColorLevel = 0 | 1 | 2 | 3;

export interface Palette {
  level: ColorLevel;
  /** The rating's pixels and the filled meter: indigo-400. */
  accent: Paint;
  /** The sparkline: indigo-300. */
  spark: Paint;
  /** The check mark and the rise: green-400. */
  good: Paint;
  /** Something that went wrong. */
  bad: Paint;
  /** The keys and the caption: zinc-500. */
  key: Paint;
  /** The status line's text: zinc-400 on dark. */
  muted: Paint;
  /** The domain and the rating's number. */
  strong: Paint;
  /** A pixel that is off, and an empty meter cell. */
  off: Paint;
  dim: Paint;
  link: (url: string, text?: string) => string;
}

type Env = Record<string, string | undefined>;

/**
 * 0: none, 1: the 16 basic colours, 2: 256 colours, 3: truecolor. NO_COLOR
 * wins over everything (https://no-color.org), FORCE_COLOR over the TTY test.
 */
export function colorLevel(env: Env, isTTY: boolean): ColorLevel {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return 0;
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    if (force === "0" || force === "false") return 0;
    if (force === "1" || force === "" || force === "true")
      return Math.max(1, detect(env)) as ColorLevel;
    const n = Number(force);
    if (n >= 1 && n <= 3) return n as ColorLevel;
  }
  if (!isTTY || env.TERM === "dumb") return 0;
  return detect(env);
}

function detect(env: Env): ColorLevel {
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) return 3;
  if (
    env.TERM_PROGRAM === "iTerm.app" ||
    env.TERM_PROGRAM === "vscode" ||
    env.TERM_PROGRAM === "WezTerm" ||
    env.TERM_PROGRAM === "ghostty" ||
    env.WT_SESSION
  )
    return 3;
  if (/256/.test(env.TERM ?? "")) return 2;
  return 1;
}

/**
 * Whether the background is light, from the `COLORFGBG` some terminals set
 * ("15;0" is white on black). Unknown means dark, which is what nearly every
 * developer terminal is.
 */
export function prefersLight(env: Env): boolean {
  const bg = (env.COLORFGBG ?? "").split(";").pop();
  return bg === "7" || bg === "15";
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The nearest colour in the xterm 6×6×6 cube or the grey ramp. */
export function to256(hex: string): number {
  const [r, g, b] = rgb(hex);
  const steps = [0, 95, 135, 175, 215, 255];
  const nearest = (v: number) =>
    steps.reduce(
      (best, step, i) =>
        Math.abs(step - v) < Math.abs(steps[best]! - v) ? i : best,
      0,
    );
  const [cr, cg, cb] = [nearest(r), nearest(g), nearest(b)];
  const cube = 16 + 36 * cr + 6 * cg + cb;
  const cubeDistance =
    (steps[cr]! - r) ** 2 + (steps[cg]! - g) ** 2 + (steps[cb]! - b) ** 2;
  const grey = Math.round((r + g + b) / 3);
  const greyIndex = Math.min(23, Math.max(0, Math.round((grey - 8) / 10)));
  const greyValue = 8 + greyIndex * 10;
  const greyDistance =
    (greyValue - r) ** 2 + (greyValue - g) ** 2 + (greyValue - b) ** 2;
  return greyDistance < cubeDistance ? 232 + greyIndex : cube;
}

function sgr(open: string, close: string): Paint {
  return (text) => (text ? `\x1b[${open}m${text}\x1b[${close}m` : text);
}

function color(level: ColorLevel, hex: string, basic: number): Paint {
  if (level === 3) {
    const [r, g, b] = rgb(hex);
    return sgr(`38;2;${r};${g};${b}`, "39");
  }
  if (level === 2) return sgr(`38;5;${to256(hex)}`, "39");
  return sgr(String(basic), "39");
}

const plain: Paint = (text) => text;

export function palette(env: Env, isTTY: boolean): Palette {
  const level = colorLevel(env, isTTY);
  if (level === 0)
    return {
      level,
      accent: plain,
      spark: plain,
      good: plain,
      bad: plain,
      key: plain,
      muted: plain,
      strong: plain,
      off: plain,
      dim: plain,
      link: (url, text) => text ?? url,
    };
  const light = prefersLight(env);
  const bold = sgr("1", "22");
  return {
    level,
    accent: color(level, light ? "#6366f1" : "#818cf8", 94),
    spark: color(level, light ? "#818cf8" : "#a5b4fc", 94),
    good: color(level, light ? "#16a34a" : "#4ade80", 92),
    bad: color(level, light ? "#dc2626" : "#f87171", 91),
    key: color(level, "#71717a", 90),
    muted: color(level, light ? "#52525b" : "#a1a1aa", 37),
    strong: bold,
    // In 16 colours there is no faint grey, so "off" falls back to the
    // bright-black that also carries the keys.
    off:
      level === 1
        ? sgr("90", "39")
        : color(level, light ? "#e4e4e7" : "#27272a", 90),
    dim: color(level, light ? "#d4d4d8" : "#3f3f46", 90),
    // OSC 8 hyperlinks: clickable where the terminal supports them, and the
    // URL itself is always the visible text so nothing is lost where not.
    link: (url, text) => `\x1b]8;;${url}\x1b\\${text ?? url}\x1b]8;;\x1b\\`,
  };
}

/** The printable width of a string that may carry SGR and OSC 8 escapes. */
export function visibleLength(text: string): number {
  return [
    ...text
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, ""),
  ].length;
}
