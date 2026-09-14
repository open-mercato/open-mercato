import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The registry has no build artefact to read, so the map on the page is checked against the
// convention files themselves. Mirrors apps/docs/__tests__/reference-example-module.test.mjs.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pageUrl = new URL('../docs/framework/modules/notification-delivery.mdx', import.meta.url);

// Scaffold copies and generator source both contain the string but declare no live types.
const EXCLUDED_FRAGMENTS = [
  join('packages', 'create-app', 'template'),
  join('packages', 'cli', 'src'),
  join('external', 'official-modules'),
];
// `build` and `.docusaurus` are produced by this workspace's own `test` script immediately before
// this walk, so leaving them in would crawl the freshly built site on every run.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.mercato',
  'build',
  '.docusaurus',
]);
const ENTERPRISE_PACKAGE = join('packages', 'enterprise') + '/';

function collectConventionFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      collectConventionFiles(full, found);
    } else if (entry.name === 'notifications.ts') {
      found.push(full);
    }
  }
  return found;
}

function conventionFiles() {
  const files = [resolve(repoRoot, 'packages'), resolve(repoRoot, 'apps')]
    .flatMap((root) => collectConventionFiles(root))
    .filter((file) => !EXCLUDED_FRAGMENTS.some((fragment) => file.includes(fragment)))
    // A module-root notifications.ts only; api/portal/notifications.ts and lib/notifications.ts
    // are unrelated files that happen to share the name.
    .filter((file) => /[\\/]modules[\\/][^\\/]+[\\/]notifications\.ts$/.test(file))
    .sort();
  assert.ok(
    files.length > 0,
    'found no notifications.ts convention files — a broken glob must fail loudly, not pass vacuously',
  );
  return files;
}

// Splits the `notificationTypes` array literal into one chunk per entry. The first `[` after the
// binding name belongs to the `NotificationTypeDefinition[]` annotation, so the array is located
// from the `=` instead.
function splitTypeEntries(source) {
  const binding = source.search(/notificationTypes[^=]*=\s*\[/);
  if (binding < 0) return [];
  const start = source.indexOf('[', source.indexOf('=', binding));
  if (start < 0) return [];
  const chunks = [];
  let depth = 0;
  let current = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      if (depth === 1) {
        current = '';
        continue;
      }
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        chunks.push(current);
        continue;
      }
    }
    if (depth === 0 && char === ']') break;
    if (depth >= 1) current += char;
  }
  return chunks;
}

/** The module directory the convention file sits in — the grouping the map's headings use. */
function moduleOf(file) {
  return /[\\/]modules[\\/]([^\\/]+)[\\/]notifications\.ts$/.exec(file)[1];
}

/** The rendered flag cell for one entry, in the order the map writes them. */
function flagsOf(chunk) {
  const flags = [];
  if (/(?:^|\n)\s*nonOptOut:\s*true/.test(chunk)) flags.push('non-opt-out');
  if (/(?:^|\n)\s*silent:\s*true/.test(chunk)) flags.push('silent');
  if (/(?:^|\n)\s*hiddenFromSettings:\s*true/.test(chunk)) flags.push('hidden from settings');
  return flags.length > 0 ? flags.join(', ') : '—';
}

/** The rendered channel cell — the declared ids, or the marker meaning "no restriction". */
function channelsOf(chunk) {
  const declared = chunk.match(/(?:^|\n)\s*channels:\s*\[([^\]]*)\]/);
  if (!declared) return '— (all registered)';
  const ids = [...declared[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(ids.length > 0, 'a declared channels list must name at least one channel id');
  return ids.map((id) => `\`${id}\``).join(', ');
}

function readRegistry() {
  const types = new Map();
  for (const file of conventionFiles()) {
    const source = readFileSync(file, 'utf8');
    // `type:` is not always a literal — push_notifications declares its two admin types through
    // module-level constants, and a naive literal-only regex would silently drop them.
    const constants = new Map();
    for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)) {
      constants.set(match[1], match[2]);
    }
    for (const chunk of splitTypeEntries(source)) {
      const declared = chunk.match(/(?:^|\n)\s*type:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/);
      if (!declared) continue;
      const id = declared[1] ?? constants.get(declared[2]);
      assert.ok(
        id,
        `could not resolve the type id in ${relative(repoRoot, file)} — extend the constant lookup rather than dropping the entry`,
      );
      const severity = chunk.match(/(?:^|\n)\s*severity:\s*'([^']+)'/);
      assert.ok(
        severity,
        `${id} declares no literal severity in ${relative(repoRoot, file)} — extend the parser rather than dropping the field`,
      );
      const relativeFile = relative(repoRoot, file);
      // Keyed on the type id, so two modules declaring the same id would otherwise collapse into one
      // entry and a single documented row would satisfy both.
      const previous = types.get(id);
      assert.ok(
        !previous,
        `notification type ${id} is declared twice — ${previous?.file} and ${relativeFile}`,
      );
      types.set(id, {
        file: relativeFile,
        module: moduleOf(file),
        enterprise: relativeFile.startsWith(ENTERPRISE_PACKAGE),
        severity: severity[1],
        channels: channelsOf(chunk),
        flags: flagsOf(chunk),
        declaresChannels: /(?:^|\n)\s*channels:\s*\[/.test(chunk),
      });
    }
  }
  assert.ok(types.size > 0, 'parsed no notification types out of the convention files');
  return types;
}

function mapSection(pageSource) {
  const start = pageSource.indexOf('<!-- notification-type-map:start -->');
  const end = pageSource.indexOf('<!-- notification-type-map:end -->');
  assert.ok(start >= 0 && end > start, 'the page must keep the notification-type-map markers');
  return pageSource.slice(start, end);
}

/** Every documented row, with its cells and the group heading it sits under. */
function documentedRows(section) {
  const rows = new Map();
  let group = null;
  for (const line of section.split('\n')) {
    const heading = line.match(/^####\s+`([^`]+)`(.*)$/);
    if (heading) {
      group = { module: heading[1], enterprise: heading[2].includes('*(enterprise)*') };
      continue;
    }
    // Segments are not always lower_snake — `checkout.link.usageLimitReached` is camelCase.
    const match = line.match(/^\|\s*`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)`\s*\|(.*)$/);
    if (!match) continue;
    const cells = match[2].split('|').map((cell) => cell.trim());
    rows.set(match[1], { line, group, severity: cells[0], channels: cells[1], flags: cells[2] });
  }
  return rows;
}

async function registryAndRows() {
  const page = await readFile(pageUrl, 'utf8');
  return { registry: readRegistry(), documented: documentedRows(mapSection(page)), page };
}

test('every registered notification type is documented in the map', async () => {
  const { registry, documented } = await registryAndRows();

  const missing = [...registry.keys()].filter((id) => !documented.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    'these notification types exist in the registry but are absent from notification-delivery.mdx',
  );
});

test('every documented notification type still exists in the registry', async () => {
  const { registry, documented } = await registryAndRows();

  const stale = [...documented.keys()].filter((id) => !registry.has(id)).sort();
  assert.deepEqual(
    stale,
    [],
    'these notification types are documented but no longer declared by any module',
  );
});

test('a type that declares no channels is rendered as eligible for every channel', async () => {
  const { registry, documented } = await registryAndRows();

  // The "no channels declared" default is the platform's sharpest edge (#5495): such a type becomes
  // push-eligible the moment a tenant connects a provider. Pinning the marker means resolving that
  // policy question cannot silently invalidate the page.
  const mismarked = [];
  for (const [id, entry] of registry) {
    const row = documented.get(id);
    if (!row) continue;
    const marked = row.line.includes('— (all registered)');
    if (entry.declaresChannels === marked) mismarked.push(id);
  }
  assert.deepEqual(
    mismarked.sort(),
    [],
    'these rows disagree with their source about whether the type declares a channel list',
  );
});

test('every documented row matches its source on severity, channels and flags', async () => {
  const { registry, documented } = await registryAndRows();

  // The whole row is asserted, not only the channels column: the page promises the map is
  // machine-checked, and a wrong severity or a missing `non-opt-out` marker is exactly the kind of
  // drift a reader cannot detect.
  const wrong = [];
  for (const [id, entry] of registry) {
    const row = documented.get(id);
    if (!row) continue;
    for (const column of ['severity', 'channels', 'flags']) {
      if (row[column] !== entry[column]) {
        wrong.push(`${id}: ${column} documented as "${row[column]}", source says "${entry[column]}"`);
      }
    }
  }
  assert.deepEqual(wrong.sort(), [], 'these documented rows disagree with their convention file');
});

test('every type is grouped under its declaring module, and enterprise groups are marked', async () => {
  const { registry, documented } = await registryAndRows();

  // Twelve of the rows are declared in packages/enterprise and are unavailable to an OSS reader, so
  // the marker on those headings is load-bearing rather than decorative.
  const wrong = [];
  for (const [id, entry] of registry) {
    const row = documented.get(id);
    if (!row) continue;
    assert.ok(row.group, `${id} is documented outside any module heading`);
    if (row.group.module !== entry.module) {
      wrong.push(`${id}: grouped under \`${row.group.module}\`, declared by \`${entry.module}\``);
    } else if (row.group.enterprise !== entry.enterprise) {
      wrong.push(
        entry.enterprise
          ? `${entry.module}: declared in packages/enterprise but its heading carries no *(enterprise)* marker`
          : `${entry.module}: marked *(enterprise)* but declared outside packages/enterprise`,
      );
    }
  }
  assert.deepEqual([...new Set(wrong)].sort(), [], 'these rows are grouped or marked incorrectly');
});

test('the stated no-channels ratio matches the registry', async () => {
  const { registry, page } = await registryAndRows();

  // The counts are prose on the one page that advertises machine-checked numbers, so adding a type
  // without a `channels` list must fail here rather than quietly making the warning wrong.
  const withoutChannels = [...registry.values()].filter((entry) => !entry.declaresChannels).length;
  assert.match(
    page,
    new RegExp(`\\*\\*${withoutChannels} of the ${registry.size} types currently in the registry omit it\\*\\*`),
    `the warning must state ${withoutChannels} of the ${registry.size} types — update notification-delivery.mdx`,
  );
});

test('every source path referenced by the notification docs exists', async () => {
  const pages = [
    '../docs/framework/modules/notification-delivery.mdx',
    '../docs/framework/modules/push-notifications.mdx',
    '../docs/framework/modules/devices.mdx',
    '../docs/user-guide/notifications-and-push.mdx',
  ];
  const missing = [];
  for (const page of pages) {
    const source = await readFile(new URL(page, import.meta.url), 'utf8');
    for (const match of source.matchAll(/`((?:packages|apps)\/[A-Za-z0-9._/-]+\.[A-Za-z]+)`/g)) {
      if (!existsSync(resolve(repoRoot, match[1]))) missing.push(`${page} → ${match[1]}`);
    }
  }
  assert.deepEqual(missing.sort(), [], 'these referenced source paths no longer exist');
});
