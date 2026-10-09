import assert from "node:assert/strict";
import test from "node:test";
import {
  colorLevel,
  palette,
  prefersLight,
  to256,
  visibleLength,
} from "../src/ansi.js";
import { parseArgs } from "../src/args.js";
import {
  rankContext,
  resampleHistory,
  riseLabel,
  standing,
} from "../src/derive.js";
import {
  fit,
  pixelWidth,
  render,
  sparkline,
  type DrcheckResult,
} from "../src/render.js";

const plain = palette({ NO_COLOR: "1" }, true);
const color = palette({ COLORTERM: "truecolor" }, true);

/** The listing on the share graphic itself. */
const GRAPHIC: DrcheckResult = {
  domain: "confettisaas.com",
  created: false,
  listing: {
    slug: "confettisaas-com",
    url: "https://domainrating.lol/tool/confettisaas-com",
    locked: false,
    claimable: false,
  },
  rating: {
    dr: 49,
    drLabel: "49",
    rank: 27,
    total: 157,
    category: "Directories, Launch & Discovery",
    measuredOn: "2026-10-09",
    history: [
      { on: "2026-09-17", dr: 45 },
      { on: "2026-09-27", dr: 46 },
      { on: "2026-10-02", dr: 47 },
      { on: "2026-10-08", dr: 48 },
      { on: "2026-10-09", dr: 49 },
    ],
    change: { delta: 4, since: "2026-09-17" },
  },
};

test("the share graphic's listing prints the graphic's lines", () => {
  const lines = render(GRAPHIC, { width: 100, palette: plain });
  assert.equal(lines[0], "✓ Domain Rating read from Ahrefs");
  assert.equal(lines[1], "");
  const block = lines.slice(2, 9).map((line) => line.slice(26));
  assert.deepEqual(block, [
    "domain     confettisaas.com",
    "rating     49/100  ███████░░░░░░░",
    "rank       #27 of 157 sites",
    "standing   top 18%",
    "category   Directories, Launch & Discovery",
    `history    ${sparkline(GRAPHIC.rating!.history, 12)}  +4 since Sep 17`,
    "measured   2026-10-09",
  ]);
  assert.equal(lines[9], "Domain Rating, out of 100");
  // Unlocked and owned: nothing to claim or unlock, so nothing after it.
  assert.equal(lines.length, 10);
});

test("the pixel face draws the rating, a cell between glyphs", () => {
  const lines = render(GRAPHIC, { width: 100, palette: plain });
  const pixels = lines.slice(2, 9).map((line) => line.slice(0, 22));
  // Row 0: "4" is 00010 and "9" is 01110. Row 4: 11111 and 00001.
  assert.equal(pixels[0], "      ██      ██████  ");
  assert.equal(pixels[4], "██████████          ██");
  assert.equal(pixelWidth("49"), 22);
  assert.equal(pixelWidth("31.9"), 38);
  assert.equal(pixelWidth("100"), 34);
});

test("a locked listing nobody owns ends with where to claim it", () => {
  const lines = render(
    {
      ...GRAPHIC,
      listing: { ...GRAPHIC.listing, locked: true, claimable: true },
    },
    { width: 100, palette: plain },
  );
  assert.deepEqual(lines.slice(-3), [
    "",
    "→ Locked: blurred card, nofollow link. Claim and unlock it at",
    "  https://domainrating.lol/tool/confettisaas-com",
  ]);
});

test("an owned locked listing is only offered the unlock", () => {
  const lines = render(
    { ...GRAPHIC, listing: { ...GRAPHIC.listing, locked: true } },
    { width: 100, palette: plain },
  );
  assert.match(lines.at(-2)!, /Unlock it at$/);
});

test("a narrow terminal stacks the pixels above the block", () => {
  const lines = render(GRAPHIC, { width: 40, palette: plain });
  assert.equal(lines[9], "Domain Rating, out of 100");
  assert.equal(lines[11], "domain     confettisaas.com");
  for (const line of lines) assert.ok(visibleLength(line) <= 39, line);
  assert.match(lines[15]!, /^category   Directories, Launch & Disco…$/);
});

test("a very narrow terminal gets the block alone", () => {
  const lines = render(GRAPHIC, { width: 21, palette: plain });
  assert.equal(lines[2], "domain     confetti…");
});

test("colour never changes the printable width", () => {
  const coloured = render(GRAPHIC, { width: 100, palette: color });
  const uncoloured = render(GRAPHIC, { width: 100, palette: plain });
  assert.notDeepEqual(coloured, uncoloured);
  assert.deepEqual(
    coloured.map(visibleLength),
    uncoloured.map((line) => [...line].length),
  );
});

test("no rating from Ahrefs says so instead of drawing a zero", () => {
  const lines = render(
    {
      ...GRAPHIC,
      rating: null,
      listing: { ...GRAPHIC.listing, locked: true, claimable: true },
    },
    { width: 100, palette: plain },
  );
  assert.equal(lines[0], "✗ Domain Rating not available from Ahrefs yet");
  assert.equal(lines[2], "domain     confettisaas.com");
  assert.match(lines.at(-1)!, /tool\/confettisaas-com$/);
});

test("standing is only offered in the top half of a big enough ranking", () => {
  assert.deepEqual(standing(27, 157), { topPercent: 18, outranks: 130 });
  assert.equal(standing(100, 157).topPercent, null);
  assert.equal(standing(1, 9).topPercent, null);
  assert.equal(rankContext(27, 157), "of 157 sites");
  assert.equal(rankContext(4, 5), "on the ranking");
  assert.equal(rankContext(2, 1500), "of 1,500 sites");
});

test("a rise is only reported when the rating went up", () => {
  assert.equal(riseLabel({ delta: 4, since: "2026-09-17" }), "+4 since Sep 17");
  assert.equal(riseLabel({ delta: 0, since: "2026-09-17" }), null);
  assert.equal(riseLabel({ delta: -2, since: "2026-09-17" }), null);
  assert.equal(riseLabel(null), null);
});

test("the sparkline resamples onto time and holds a single reading flat", () => {
  assert.equal(sparkline([{ on: "2026-10-09", dr: 30 }], 12), "▄".repeat(12));
  assert.deepEqual(
    resampleHistory(
      [
        { on: "2026-01-01", dr: 10 },
        { on: "2026-01-11", dr: 20 },
      ],
      3,
    ),
    [10, 10, 20],
  );
  const bars = sparkline(GRAPHIC.rating!.history, 12);
  assert.equal(bars[0], "▁");
  assert.equal(bars.at(-1), "█");
});

test("fit cuts on columns and ends in an ellipsis", () => {
  assert.deepEqual(fit([{ text: "abcdef" }], 6), [{ text: "abcdef" }]);
  assert.deepEqual(
    fit([{ text: "abc" }, { text: "def" }], 5)
      .map((s) => s.text)
      .join(""),
    "abcd…",
  );
});

test("colour follows NO_COLOR, FORCE_COLOR and the TTY", () => {
  assert.equal(colorLevel({ NO_COLOR: "1", FORCE_COLOR: "3" }, true), 0);
  assert.equal(colorLevel({}, false), 0);
  assert.equal(colorLevel({ FORCE_COLOR: "1" }, false), 1);
  assert.equal(colorLevel({ COLORTERM: "truecolor" }, true), 3);
  assert.equal(colorLevel({ TERM: "xterm-256color" }, true), 2);
  assert.equal(colorLevel({ TERM: "dumb" }, true), 0);
  assert.equal(prefersLight({ COLORFGBG: "0;15" }), true);
  assert.equal(prefersLight({ COLORFGBG: "15;0" }), false);
  assert.equal(to256("#000000"), 16);
  assert.equal(to256("#ffffff"), 231);
});

test("the command line takes one domain and a few flags", () => {
  assert.deepEqual(parseArgs(["example.com"]), {
    kind: "check",
    domain: "example.com",
    json: false,
    create: true,
  });
  assert.deepEqual(parseArgs(["--json", "--no-create", "example.com"]), {
    kind: "check",
    domain: "example.com",
    json: true,
    create: false,
  });
  assert.equal(parseArgs([]).kind, "usage");
  assert.equal(parseArgs(["a.com", "b.com"]).kind, "usage");
  assert.equal(parseArgs(["--nope", "a.com"]).kind, "usage");
  assert.equal(parseArgs(["a.com", "-h"]).kind, "help");
  assert.equal(parseArgs(["-v"]).kind, "version");
});
