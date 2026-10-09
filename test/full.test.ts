import assert from "node:assert/strict";
import test from "node:test";
import { palette, visibleLength } from "../src/ansi.js";
import { frame, type FullState } from "../src/full.js";
import { pixelWidth, pixels, type DrcheckResult } from "../src/render.js";

const plain = palette({ NO_COLOR: "1" }, true);
const color = palette({ COLORTERM: "truecolor" }, true);
const clock = (date: Date) => date.toISOString().slice(11, 16);

const RESULT: DrcheckResult = {
  domain: "watson.ch",
  created: false,
  listing: {
    slug: "watson-ch",
    url: "https://domainrating.lol/tool/watson-ch",
    locked: true,
    claimable: false,
  },
  rating: {
    dr: 79,
    drLabel: "79",
    rank: 4,
    total: 12,
    category: "Media & News",
    measuredOn: "2026-10-09",
    history: [{ on: "2026-10-09", dr: 79 }],
    change: null,
  },
};

const STATE: FullState = {
  result: RESULT,
  updatedAt: new Date("2026-10-09T14:03:00Z"),
  nextAt: new Date("2026-10-09T15:03:00Z"),
  refreshing: false,
  error: null,
};

test("the screen fills the terminal exactly and never wraps", () => {
  for (const size of [
    { columns: 80, rows: 24 },
    { columns: 160, rows: 45 },
    { columns: 40, rows: 12 },
  ]) {
    const screen = frame(STATE, size, color, clock);
    assert.equal(screen.length, size.rows);
    for (const row of screen)
      assert.ok(
        visibleLength(row) <= size.columns - 1,
        `${size.columns}: ${row}`,
      );
  }
});

test("the title, the prompt and the status read like the share graphic", () => {
  const screen = frame(STATE, { columns: 80, rows: 24 }, plain, clock);
  assert.equal(screen[0]!.trim(), "drcheck — domainrating.lol");
  assert.ok(screen.some((row) => row.trim() === "$ drcheck watson.ch"));
  assert.match(
    screen.at(-1)!,
    /^ updated 14:03 · next update 15:03 +r refresh {2}q quit$/,
  );
});

test("the output is centred in the space between title and status", () => {
  const screen = frame(STATE, { columns: 80, rows: 24 }, plain, clock);
  const body = screen.slice(1, -1);
  const used = body
    .map((row, i) => (row.trim() ? i : -1))
    .filter((i) => i >= 0);
  const above = used[0]!;
  const below = body.length - 1 - used.at(-1)!;
  assert.ok(Math.abs(above - below) <= 1, `${above} above, ${below} below`);
  const lefts = body
    .filter((row) => row.trim())
    .map((row) => row.length - row.trimStart().length);
  assert.ok(Math.min(...lefts) > 0);
});

test("a big screen gets the double-size pixels, a small one the usual", () => {
  const big = frame(STATE, { columns: 160, rows: 45 }, plain, clock).join("\n");
  const small = frame(STATE, { columns: 80, rows: 24 }, plain, clock).join(
    "\n",
  );
  assert.ok(big.includes("▐██▌"));
  assert.ok(!small.includes("▐██▌"));
  assert.ok(small.includes("▗▖"));
  // Wide enough but too short: the double face would not fit, so it is not used.
  const short = frame(STATE, { columns: 160, rows: 20 }, plain, clock).join(
    "\n",
  );
  assert.ok(!short.includes("▐██▌"));
});

test("a refresh and a failed one say so in the status line", () => {
  const refreshing = frame(
    { ...STATE, refreshing: true, nextAt: null },
    { columns: 80, rows: 24 },
    plain,
    clock,
  );
  assert.match(refreshing.at(-1)!, /^ Refreshing… +r refresh/);
  const failed = frame(
    {
      ...STATE,
      error: "Could not reach domainrating.lol: the request timed out.",
    },
    { columns: 100, rows: 24 },
    plain,
    clock,
  );
  assert.match(
    failed.at(-1)!,
    /^ ✗ Could not reach .* · retrying 15:03 +r refresh/,
  );
});

test("double-size pixels are four columns by two rows each", () => {
  const rows = pixels("7", plain, 2).map((row) =>
    row.map((s) => s.text).join(""),
  );
  assert.equal(rows.length, 14);
  // "7" starts 11111: the whole first row of cells is lit.
  assert.equal(rows[0], "  ▗▄▄▖▗▄▄▖▗▄▄▖▗▄▄▖▗▄▄▖");
  assert.equal(rows[1], "  ▐██▌▐██▌▐██▌▐██▌▐██▌");
  assert.equal(pixelWidth("79", 2), 45);
  assert.equal(pixelWidth("79", 1), 23);
});
