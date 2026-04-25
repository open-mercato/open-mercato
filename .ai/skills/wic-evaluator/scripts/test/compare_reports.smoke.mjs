#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const comparator = resolve(here, "..", "compare_reports.mjs");

const HEADER =
  "| Person | GH profile | Month | WIC script version | WIC Score | WIC Level | Bounty bonus | Why bonus | What we included and why? | What we excluded and why? |";
const DIVIDER = "|---|---|---|---|---:|---|---:|---|---|---|";

function report({ score, level, bounty }) {
  return `# Report\n\n${HEADER}\n${DIVIDER}\n| Alice | alice | 2026-04 | 1.0-agent | ${score} | ${level} | ${bounty} | Bounty X | Spec + impl | Routine fixes |\n`;
}

function run(args) {
  return spawnSync(process.execPath, [comparator, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`FAIL: ${message}\n`);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "wic-smoke-"));
try {
  const a = join(dir, "a.md");
  const b = join(dir, "b.md");
  const c = join(dir, "c.md");
  writeFileSync(a, report({ score: "1.5", level: "L4", bounty: "0.5" }));
  writeFileSync(b, report({ score: "1.5", level: "L4", bounty: "0.5" }));
  writeFileSync(c, report({ score: "1.25", level: "L4", bounty: "0.25" }));

  const identical = run([a, b]);
  assert(identical.status === 0, `identical reports should exit 0, got ${identical.status}`);
  const identicalParsed = JSON.parse(identical.stdout);
  assert(identicalParsed.scoringMatchAll === true, "scoringMatchAll must be true for identical reports");
  assert(identicalParsed.exactMatchAll === true, "exactMatchAll must be true for identical reports");

  const divergent = run([a, c]);
  assert(divergent.status === 1, `divergent scoring should exit 1, got ${divergent.status}`);
  const divergentParsed = JSON.parse(divergent.stdout);
  assert(divergentParsed.scoringMatchAll === false, "scoringMatchAll must be false for divergent scoring");
  assert(
    divergentParsed.diffs[0].scoringDiff["WIC Score"]?.actual === "1.25",
    "scoringDiff must surface the WIC Score delta",
  );

  const usage = run([]);
  assert(usage.status === 1, `no-args should exit 1, got ${usage.status}`);
  assert(/Usage:/.test(usage.stderr), "no-args must print usage on stderr");

  process.stdout.write("OK — compare_reports.mjs smoke test passed\n");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
