#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_HEADERS = [
  "Person",
  "GH profile",
  "Month",
  "WIC script version",
  "WIC Score",
  "WIC Level",
  "Bounty bonus",
  "Why bonus",
  "What we included and why?",
  "What we excluded and why?",
];

const SCORING_FIELDS = ["WIC Score", "WIC Level", "Bounty bonus", "Why bonus"];
const PRESERVE_WHITESPACE_FIELDS = new Set(["WIC Score", "Bounty bonus"]);

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function parsePipeRow(line) {
  const stripped = line.trim();
  if (!stripped.startsWith("|") || !stripped.endsWith("|")) {
    throw new Error(`Invalid markdown table row: ${line.replace(/\s+$/, "")}`);
  }
  return stripped.slice(1, -1).split("|").map((cell) => cell.trim());
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function parseReport(path) {
  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  let headerIndex = -1;
  let headers = null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (!line.trim().startsWith("|")) continue;
    const cells = parsePipeRow(line);
    if (arraysEqual(cells, EXPECTED_HEADERS)) {
      headerIndex = idx;
      headers = cells;
      break;
    }
  }

  if (headerIndex === -1 || headers === null) {
    throw new Error(`Could not find expected WIC table in ${path}`);
  }

  const rowIndex = headerIndex + 2;
  if (rowIndex >= lines.length) {
    throw new Error(`Missing data row in ${path}`);
  }

  const dataCells = parsePipeRow(lines[rowIndex]);
  if (dataCells.length !== headers.length) {
    throw new Error(`Unexpected data row width in ${path}`);
  }

  const row = Object.fromEntries(headers.map((key, idx) => [key, dataCells[idx]]));
  const exactHash = createHash("sha256").update(content, "utf8").digest("hex");

  const normalized = Object.fromEntries(
    headers.map((key) => [
      key,
      PRESERVE_WHITESPACE_FIELDS.has(key) ? row[key].trim() : normalizeText(row[key]),
    ]),
  );

  return { path, exactHash, row, normalized };
}

function diffFields(reference, current, fields) {
  const diff = {};
  for (const field of fields) {
    if (current.normalized[field] !== reference.normalized[field]) {
      diff[field] = {
        expected: reference.normalized[field],
        actual: current.normalized[field],
      };
    }
  }
  return diff;
}

function compareReports(paths) {
  const parsed = paths.map((path) => parseReport(path));
  const [reference, ...rest] = parsed;

  let exactMatches = true;
  let scoringMatches = true;
  let fieldMatches = true;
  const diffs = [];

  for (const current of rest) {
    const exactMatch = current.exactHash === reference.exactHash;
    if (!exactMatch) exactMatches = false;

    const scoringDiff = diffFields(reference, current, SCORING_FIELDS);
    if (Object.keys(scoringDiff).length > 0) scoringMatches = false;

    const fieldDiff = diffFields(reference, current, EXPECTED_HEADERS);
    if (Object.keys(fieldDiff).length > 0) fieldMatches = false;

    diffs.push({ path: current.path, exactMatch, scoringDiff, fieldDiff });
  }

  const result = {
    reference: reference.path,
    reportCount: parsed.length,
    exactMatchAll: exactMatches,
    scoringMatchAll: scoringMatches,
    fieldMatchAll: fieldMatches,
    diffs,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return scoringMatches ? 0 : 1;
}

function main(argv) {
  if (argv.length < 2) {
    process.stderr.write(
      "Usage: node .ai/skills/wic-evaluator/scripts/compare_reports.mjs <report-a.md> <report-b.md> [...]\n",
    );
    return 1;
  }
  const paths = argv.map((arg) => resolve(arg));
  return compareReports(paths);
}

process.exit(main(process.argv.slice(2)));
