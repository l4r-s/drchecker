import type { Paint } from "./ansi.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  stop(): void;
}

/**
 * A one-line spinner on stderr, so stdout stays exactly the output. Only on
 * a TTY: piped or redirected, it prints nothing at all. It counts seconds
 * once a wait is long enough to wonder about.
 */
export function spin(
  stream: NodeJS.WriteStream,
  text: string,
  paint: Paint,
): Spinner {
  if (!stream.isTTY) return { stop() {} };
  const started = Date.now();
  let frame = 0;
  const draw = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const elapsed = seconds >= 3 ? ` ${seconds}s` : "";
    const line = `${paint(FRAMES[frame % FRAMES.length]!)} ${text}${elapsed}`;
    stream.write(`\r\x1b[2K${line}`);
    frame += 1;
  };
  const restore = () => stream.write("\r\x1b[2K\x1b[?25h");
  const onExit = () => restore();
  process.once("exit", onExit);
  stream.write("\x1b[?25l");
  draw();
  const timer = setInterval(draw, 80);
  return {
    stop() {
      clearInterval(timer);
      process.removeListener("exit", onExit);
      restore();
    },
  };
}
