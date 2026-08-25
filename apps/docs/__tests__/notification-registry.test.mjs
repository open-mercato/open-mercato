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
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.turbo', '.mercato']);

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
      types.set(id, {
        file: relative(repoRoot, file),
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

function documentedRows(section) {
  const rows = new Map();
  for (const line of section.split('\n')) {
    // Segments are not always lower_snake — `checkout.link.usageLimitReached` is camelCase.
    const match = line.match(/^\|\s*`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)`\s*\|/);
    if (!match) continue;
    rows.set(match[1], line);
  }
  return rows;
}

test('every registered notification type is documented in the map', async () => {
  const registry = readRegistry();
  const documented = documentedRows(mapSection(await readFile(pageUrl, 'utf8')));

  const missing = [...registry.keys()].filter((id) => !documented.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    'these notification types exist in the registry but are absent from notification-delivery.mdx',
  );
});

test('every documented notification type still exists in the registry', async () => {
  const registry = readRegistry();
  const documented = documentedRows(mapSection(await readFile(pageUrl, 'utf8')));

  const stale = [...documented.keys()].filter((id) => !registry.has(id)).sort();
  assert.deepEqual(
    stale,
    [],
    'these notification types are documented but no longer declared by any module',
  );
});

test('a type that declares no channels is rendered as eligible for every channel', async () => {
  const registry = readRegistry();
  const documented = documentedRows(mapSection(await readFile(pageUrl, 'utf8')));

  // The "no channels declared" default is the platform's sharpest edge (#5495): such a type becomes
  // push-eligible the moment a tenant connects a provider. Pinning the marker means resolving that
  // policy question cannot silently invalidate the page.
  const mismarked = [];
  for (const [id, entry] of registry) {
    const row = documented.get(id);
    if (!row) continue;
    const marked = row.includes('— (all registered)');
    if (entry.declaresChannels === marked) mismarked.push(id);
  }
  assert.deepEqual(
    mismarked.sort(),
    [],
    'these rows disagree with their source about whether the type declares a channel list',
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
