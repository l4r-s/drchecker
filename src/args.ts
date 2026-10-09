/** The command line, parsed. Kept apart from cli.ts, which runs on import. */

export type Args =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "usage"; message: string }
  | { kind: "check"; domain: string; json: boolean; create: boolean };

export function parseArgs(argv: readonly string[]): Args {
  let json = false;
  let createListing = true;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "-v" || arg === "--version") return { kind: "version" };
    if (arg === "--json") json = true;
    else if (arg === "--no-create") createListing = false;
    else if (arg.startsWith("-") && arg.length > 1)
      return { kind: "usage", message: `Unknown option: ${arg}` };
    else if (arg.trim()) positional.push(arg.trim());
  }
  if (positional.length === 0)
    return {
      kind: "usage",
      message: "Which domain? Try: npx drcheck example.com",
    };
  if (positional.length > 1)
    return {
      kind: "usage",
      message: `One domain at a time, please (got ${positional.length}).`,
    };
  return {
    kind: "check",
    domain: positional[0]!,
    json,
    create: createListing,
  };
}
