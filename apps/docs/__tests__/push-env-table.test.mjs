import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The env table on push-notifications.mdx restates numbers that live in the module's source. Review
// of #5618 found three rows that had gone to `—` while the code had real defaults, which is the
// failure this file exists to make impossible: the table is checked against the source, not typed
// from memory.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pageUrl = new URL('../docs/framework/modules/push-notifications.mdx', import.meta.url);
const moduleRoot = resolve(repoRoot, 'packages/core/src/modules/push_notifications');

// Test and integration sources set these variables rather than reading them for behaviour, so they
// say nothing about what the module supports.
const SKIPPED_SOURCE_FRAGMENTS = ['__tests__', '__integration__'];

// Where each documented default and floor is declared. The numbers are NOT repeated here — only the
// location — so changing a default in the module fails this test until the table is updated.
const SOURCES = {
  OM_PUSH_SEND_TIMEOUT_MS: {
    file: 'lib/push-delivery.ts',
    default: /const DEFAULT_SEND_TIMEOUT_MS = ([\d_]+)/,
    min: /const MIN_SEND_TIMEOUT_MS = ([\d_]+)/,
  },
  OM_PUSH_STUCK_RECLAIM_MINUTES: {
    file: 'lib/reclaim-window.ts',
    default: /DEFAULT_STUCK_MINUTES = ([\d_]+)/,
    min: /MIN_STUCK_MINUTES = ([\d_]+)/,
  },
  OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT: {
    file: 'lib/push-reaper.ts',
    default: /DEFAULT_RECLAIM_BATCH_LIMIT = ([\d_]+)/,
  },
  OM_PUSH_RECLAIM_TICK_SECONDS: {
    file: 'setup.ts',
    default: /process\.env\.OM_PUSH_RECLAIM_TICK_SECONDS \?\? '([\d_]+)'/,
    min: /Math\.max\(\s*([\d_]+),\s*\n?\s*Number\.parseInt\(process\.env\.OM_PUSH_RECLAIM_TICK_SECONDS/,
  },
  OM_PUSH_RECEIPT_MIN_AGE_MINUTES: {
    file: 'lib/push-receipt-reaper.ts',
    default: /envInt\('OM_PUSH_RECEIPT_MIN_AGE_MINUTES', ([\d_]+)\)/,
  },
  OM_PUSH_RECEIPT_MAX_AGE_MINUTES: {
    file: 'lib/push-receipt-reaper.ts',
    default: /envInt\('OM_PUSH_RECEIPT_MAX_AGE_MINUTES', ([\d_]+)\)/,
  },
  OM_PUSH_RECEIPT_BATCH_LIMIT: {
    file: 'lib/push-receipt-reaper.ts',
    default: /envInt\('OM_PUSH_RECEIPT_BATCH_LIMIT', ([\d_]+)\)/,
  },
};

// Feature switches rather than tuned numbers: the table documents them as on/off, so there is no
// numeric default to pin.
const SWITCHES = new Set(['OM_ENABLE_PUSH_STUB_ADAPTER', 'OM_PUSH_FAKE_PROVIDERS']);

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_SOURCE_FRAGMENTS.includes(entry.name)) continue;
      sourceFiles(full, found);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

// A name reaches the runtime either as a property access or as a quoted literal handed to a helper
// (`envInt('OM_…', 15)`, `const PUSH_STUB_ENV = 'OM_…'`). Unquoted mentions are prose in comments and
// must not count as a read.
const ENV_NAME = 'OM_[A-Z0-9_]*PUSH[A-Z0-9_]*';
const ENV_READ_PATTERNS = [
  new RegExp(`process\\.env\\.(${ENV_NAME})`, 'g'),
  new RegExp(`'(${ENV_NAME})'`, 'g'),
];

/** Every env var the module actually reads, which is what the page's frontmatter promises to list. */
function readEnvNames() {
  const names = new Set();
  for (const file of sourceFiles(moduleRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of ENV_READ_PATTERNS) {
      for (const match of source.matchAll(pattern)) names.add(match[1]);
    }
  }
  assert.ok(names.size > 0, 'read no env vars out of the push_notifications module — the walk is broken');
  return names;
}

/** The `Environment variables` table, as variable name → { default, effect }. */
function documentedEnvRows(page) {
  const start = page.indexOf('## Environment variables');
  assert.ok(start >= 0, 'push-notifications.mdx must keep its Environment variables section');
  const section = page.slice(start, page.indexOf('\n## ', start + 1));
  const rows = new Map();
  for (const line of section.split('\n')) {
    const match = line.match(/^\|\s*`(OM_[A-Z0-9_]+)`\s*\|([^|]*)\|([^|]*)\|/);
    if (!match) continue;
    rows.set(match[1], { default: match[2].trim(), effect: match[3].trim() });
  }
  assert.ok(rows.size > 0, 'parsed no rows out of the Environment variables table');
  return rows;
}

function sourceNumber(file, pattern, name, field) {
  const source = readFileSync(resolve(moduleRoot, file), 'utf8');
  const match = source.match(pattern);
  assert.ok(match, `could not read the ${field} for ${name} out of ${file} — update the pattern`);
  return Number(match[1].replaceAll('_', ''));
}

test('the env table lists exactly the variables the module reads', async () => {
  const documented = documentedEnvRows(await readFile(pageUrl, 'utf8'));
  const read = readEnvNames();

  assert.deepEqual(
    [...read].filter((name) => !documented.has(name)).sort(),
    [],
    'these env vars are read by push_notifications but missing from the table',
  );
  assert.deepEqual(
    [...documented.keys()].filter((name) => !read.has(name)).sort(),
    [],
    'these env vars are documented but no longer read by push_notifications',
  );
});

test('every documented default matches the value in the source', async () => {
  const documented = documentedEnvRows(await readFile(pageUrl, 'utf8'));

  const wrong = [];
  for (const [name, row] of documented) {
    if (SWITCHES.has(name)) {
      if (row.default !== 'off') wrong.push(`${name}: a feature switch must document its default as "off"`);
      continue;
    }
    const source = SOURCES[name];
    assert.ok(source, `${name} has no source lookup — add one rather than leaving its default unchecked`);

    // A default cell reads `<default>` or `<default> (min <floor>)`; anything else hides the number.
    const cell = row.default.match(/^(\d+)(?: \(min (\d+)\))?$/);
    if (!cell) {
      wrong.push(`${name}: default cell "${row.default}" must be a number, optionally "N (min M)"`);
      continue;
    }
    const expected = sourceNumber(source.file, source.default, name, 'default');
    if (Number(cell[1]) !== expected) {
      wrong.push(`${name}: documented default ${cell[1]}, source says ${expected}`);
    }
    if (cell[2] !== undefined) {
      assert.ok(source.min, `${name} documents a floor but has no source lookup for it`);
      const expectedMin = sourceNumber(source.file, source.min, name, 'floor');
      if (Number(cell[2]) !== expectedMin) {
        wrong.push(`${name}: documented floor ${cell[2]}, source says ${expectedMin}`);
      }
    }
  }
  assert.deepEqual(wrong.sort(), [], 'these env table rows disagree with the module source');
});

test('the send timeout row points at the clamp that can override it', async () => {
  const page = await readFile(pageUrl, 'utf8');
  const documented = documentedEnvRows(page);

  // The effective timeout is min(configured, max(MIN, reclaim window - margin)), so a reader who
  // takes the row at face value can set a value that is silently discarded. The row must say so and
  // the page must carry the explanation.
  assert.match(
    documented.get('OM_PUSH_SEND_TIMEOUT_MS').effect,
    /[Cc]lamped/,
    'the send timeout row must state that the value is clamped',
  );
  assert.match(
    documented.get('OM_PUSH_STUCK_RECLAIM_MINUTES').effect,
    /send timeout/,
    'the reclaim window row must state that it caps the send timeout',
  );
  assert.match(
    page,
    /The send timeout and the reclaim window are one knob, not two/,
    'the page must keep the callout explaining the clamp',
  );

  const delivery = readFileSync(resolve(moduleRoot, 'lib/push-delivery.ts'), 'utf8');
  assert.match(
    delivery,
    /Math\.min\(configured, ceiling\)/,
    'the clamp is gone from push-delivery.ts — the callout on push-notifications.mdx is now wrong',
  );
});
