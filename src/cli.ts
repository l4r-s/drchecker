#!/usr/bin/env node
import { createRequire } from "node:module";
import { palette, type Palette } from "./ansi.js";
import { ApiError, DEFAULT_API_URL, create, lookup } from "./api.js";
import { render, type DrcheckResult } from "./render.js";
import { parseArgs, type Args } from "./args.js";
import { runFull } from "./full.js";
import { spin } from "./spinner.js";

/**
 * domainrating, also installed as `drcheck`: a website's Domain Rating, its
 * rank on domainrating.lol, its category and its history, printed the way
 * The Terminal share graphic draws them.
 *
 * npm would not take the name `drcheck` (too close to `depcheck`), so the
 * package carries the site's name and keeps `drcheck` as a second command.
 *
 * A domain that is not on domainrating.lol yet is listed there, locked, and
 * the output ends with the listing's page, where it can be claimed and
 * unlocked.
 */

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const HELP = `domainrating ${version}: a website's Domain Rating from your terminal

Usage
  npx domainrating <domain>

Options
  --full        Full screen, refreshed every hour (r refreshes, q quits)
  --json        Print the raw result as JSON
  --no-create   Only look the domain up; never list it
  -v, --version Print the version
  -h, --help    Print this help

A domain that is not on domainrating.lol yet is listed there, locked, with
its title, description and category drafted from its own website. The output
ends with a link to claim and unlock it.

Environment
  NO_COLOR          Turn colour off
  FORCE_COLOR       Force colour on (1, 2 or 3)
  DRCHECK_API_URL   Talk to another server (default ${DEFAULT_API_URL})

Examples
  npx domainrating confettisaas.com
  npx domainrating confettisaas.com --full
  npx domainrating https://www.example.com/pricing --json

Installed globally (npm i -g domainrating), the command is also drcheck.
`;

/** What the user typed, as a hostname, for the progress line only. The
 *  server does the real validation. */
function hostOf(input: string): string {
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
    return url.hostname.replace(/^www\./, "");
  } catch {
    return input;
  }
}

function apiBase(): string {
  const configured = process.env.DRCHECK_API_URL?.trim();
  return (configured || DEFAULT_API_URL).replace(/\/+$/, "");
}

function fail(p: Palette, message: string): number {
  process.stderr.write(`${p.bad("✗")} ${message}\n`);
  return 1;
}

async function check(
  args: Extract<Args, { kind: "check" }>,
  p: Palette,
): Promise<number> {
  const errP = palette(process.env, Boolean(process.stderr.isTTY));
  // Keys come from stdin and the screen goes to stdout: both have to be the
  // terminal, not a pipe.
  if (args.full && !(process.stdout.isTTY && process.stdin.isTTY))
    return fail(errP, "--full needs an interactive terminal.");
  const options = {
    baseUrl: apiBase(),
    userAgent: `domainrating/${version} (+https://github.com/l4r-s/domainrating)`,
  };
  const host = hostOf(args.domain);
  const quiet = args.json;
  const status = (text: string) =>
    quiet ? { stop() {} } : spin(process.stderr, text, errP.accent);

  let result: DrcheckResult | null;
  let spinner = status(`Checking ${host}`);
  try {
    result = await lookup(args.domain, options);
  } catch (error) {
    spinner.stop();
    return fail(errP, error instanceof Error ? error.message : String(error));
  }
  spinner.stop();

  if (!result) {
    if (!args.create)
      return fail(
        errP,
        `${host} is not on domainrating.lol yet. Run without --no-create to list it.`,
      );
    spinner = status(
      `${host} is not on domainrating.lol yet. Listing it: reading the site, drafting the listing, asking Ahrefs`,
    );
    try {
      result = await create(args.domain, options);
    } catch (error) {
      spinner.stop();
      if (error instanceof ApiError && error.code === "not_on_ranking")
        return fail(errP, error.message);
      return fail(errP, error instanceof Error ? error.message : String(error));
    }
    spinner.stop();
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (args.full)
    return runFull({
      result,
      // The refresh only ever reads: listing happened, if at all, above.
      refresh: () => lookup(args.domain, options),
      palette: p,
      stdout: process.stdout,
      stdin: process.stdin,
    });

  const lines = render(result, {
    width: process.stdout.columns || 80,
    palette: p,
  });
  const lead = result.created
    ? [
        `${p.good("✓")} ${p.muted(`Listed ${result.domain} on domainrating.lol`)}`,
      ]
    : [];
  process.stdout.write(`${[...lead, ...lines, ""].join("\n")}\n`);
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const p = palette(process.env, Boolean(process.stdout.isTTY));
  const args = parseArgs(argv);
  switch (args.kind) {
    case "help":
      process.stdout.write(HELP);
      return 0;
    case "version":
      process.stdout.write(`${version}\n`);
      return 0;
    case "usage":
      process.stderr.write(`${args.message}\n\n${HELP}`);
      return 2;
    case "check":
      return check(args, p);
  }
}

process.on("SIGINT", () => {
  // The spinner hides the cursor; give it back on the way out.
  if (process.stderr.isTTY) process.stderr.write("\x1b[?25h\n");
  process.exit(130);
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`domainrating crashed: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
