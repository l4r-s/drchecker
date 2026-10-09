import { visibleLength, type Palette } from "./ansi.js";
import {
  render,
  sideBySideColumns,
  type DrcheckResult,
  type Scale,
} from "./render.js";

/**
 * `drcheck <domain> --full`: the check as a screen of its own, refreshed
 * every hour.
 *
 * It takes over the terminal's alternate screen, the way `less` and `htop`
 * do, so quitting puts back whatever was there. The window is the share
 * graphic's: its title along the top, the `$ drcheck <domain>` prompt, then
 * the same output the plain command prints, centred, with the pixel face at
 * double size when the screen has room for it. The bottom line says when it
 * last read the rating and when it reads it next.
 *
 * `frame` builds the screen from state and is pure, so it is what the tests
 * drive; `runFull` is the loop around it.
 */

export const REFRESH_MS = 60 * 60_000;
/** After a failed refresh: soon, but not so soon it hammers a server that
 *  is down. */
export const RETRY_MS = 5 * 60_000;

const TITLE = "drcheck — domainrating.lol";

export type FullState = {
  result: DrcheckResult;
  /** When the result on screen was read. */
  updatedAt: Date;
  /** When it is read next; null while a refresh is running. */
  nextAt: Date | null;
  refreshing: boolean;
  /** Why the last refresh failed, cleared by the next one that works. */
  error: string | null;
};

export type ScreenSize = { columns: number; rows: number };

function localClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function center(text: string, columns: number): string {
  const free = columns - 1 - visibleLength(text);
  return free > 0 ? " ".repeat(Math.floor(free / 2)) + text : text;
}

function statusLine(
  state: FullState,
  columns: number,
  p: Palette,
  clock: (date: Date) => string,
): string {
  const keys = p.key("r refresh  q quit");
  const at = state.nextAt ? clock(state.nextAt) : null;
  const left = state.refreshing
    ? p.muted("Refreshing…")
    : state.error
      ? `${p.bad("✗")} ${p.muted(`${state.error}${at ? ` · retrying ${at}` : ""}`)}`
      : p.muted(
          `updated ${clock(state.updatedAt)}${at ? ` · next update ${at}` : ""}`,
        );
  // A column of margin either side, plus the last one left free so the
  // bottom row never wraps and scrolls the screen.
  const room = columns - 3;
  const gap = room - visibleLength(left) - visibleLength(keys);
  if (gap >= 2) return ` ${left}${" ".repeat(gap)}${keys}`;
  return ` ${visibleLength(left) <= room ? left : keys}`;
}

/**
 * The screen, exactly `size.rows` lines: the title, the output centred in
 * the space left, and the status line at the bottom. The pixel face is drawn
 * at double size when that still fits beside the block and on the screen.
 */
export function frame(
  state: FullState,
  size: ScreenSize,
  p: Palette,
  clock: (date: Date) => string = localClock,
): string[] {
  const columns = Math.max(20, size.columns);
  const rows = Math.max(3, size.rows);
  const available = rows - 2;
  const prompt = `${p.accent("$")} drcheck ${state.result.domain}`;
  const content = (scale: Scale) => [
    prompt,
    ...render(state.result, { width: columns - 2, palette: p, scale }),
  ];

  const label = state.result.rating?.drLabel;
  let body = content(1);
  if (label && columns - 2 >= sideBySideColumns(label, 2)) {
    const large = content(2);
    if (large.length <= available) body = large;
  }

  const width = Math.max(...body.map(visibleLength));
  const left = " ".repeat(Math.max(0, Math.floor((columns - width) / 2)));
  const top = Math.max(0, Math.floor((available - body.length) / 2));
  const middle = [
    ...Array.from({ length: top }, () => ""),
    ...body.map((line) => (line ? left + line : line)),
  ].slice(0, available);
  while (middle.length < available) middle.push("");

  return [
    p.key(center(TITLE, columns)),
    ...middle,
    statusLine(state, columns, p, clock),
  ];
}

const ENTER = "\x1b[?1049h\x1b[?25l\x1b[2J";
const LEAVE = "\x1b[?25h\x1b[?1049l";
const QUIT_KEYS = new Set(["q", "Q", "\x03", "\x1b"]);

export interface FullOptions {
  result: DrcheckResult;
  /** The next reading, or null when the domain is no longer listed. */
  refresh: () => Promise<DrcheckResult | null>;
  palette: Palette;
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  intervalMs?: number;
  retryMs?: number;
}

/** Runs until the user quits, then hands the terminal back as it was. */
export function runFull(options: FullOptions): Promise<number> {
  const { stdout, stdin, palette } = options;
  const interval = options.intervalMs ?? REFRESH_MS;
  const retry = Math.min(options.retryMs ?? RETRY_MS, interval);
  const state: FullState = {
    result: options.result,
    updatedAt: new Date(),
    nextAt: new Date(Date.now() + interval),
    refreshing: false,
    error: null,
  };
  let timer: NodeJS.Timeout | undefined;

  const paint = () => {
    const screen = frame(
      state,
      { columns: stdout.columns || 80, rows: stdout.rows || 24 },
      palette,
    );
    // Home, every row cleared to its end as it is written, and everything
    // below cleared once: a redraw that never blanks the screen first, so it
    // does not flicker.
    stdout.write(
      `\x1b[H${screen.map((row) => `${row}\x1b[K`).join("\r\n")}\x1b[J`,
    );
  };

  const schedule = (ms: number) => {
    clearTimeout(timer);
    state.nextAt = new Date(Date.now() + ms);
    timer = setTimeout(() => void update(), ms);
  };

  const update = async () => {
    if (state.refreshing) return;
    clearTimeout(timer);
    state.refreshing = true;
    state.nextAt = null;
    paint();
    try {
      const next = await options.refresh();
      if (next) {
        state.result = next;
        state.updatedAt = new Date();
        state.error = null;
        schedule(interval);
      } else {
        state.error = `${state.result.domain} is no longer on domainrating.lol`;
        schedule(retry);
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      schedule(retry);
    }
    state.refreshing = false;
    paint();
  };

  return new Promise((resolve) => {
    const restore = () => stdout.write(LEAVE);
    const onKey = (key: string) => {
      if (QUIT_KEYS.has(key)) done();
      else if (key === "r" || key === "R") void update();
    };
    const done = () => {
      clearTimeout(timer);
      stdout.off("resize", paint);
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      process.off("exit", restore);
      process.off("SIGTERM", done);
      restore();
      resolve(0);
    };

    // Whatever happens, the terminal is not left on the alternate screen.
    process.once("exit", restore);
    process.once("SIGTERM", done);
    stdout.write(ENTER);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onKey);
    stdin.resume();
    stdout.on("resize", paint);
    schedule(interval);
    paint();
  });
}
