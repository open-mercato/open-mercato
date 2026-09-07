import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const inventoryUrl = new URL(
  '../../mercato/src/modules/example/references/surface-inventory.json',
  import.meta.url,
);
const pageUrl = new URL(
  '../docs/framework/modules/reference-example-module.mdx',
  import.meta.url,
);
const mercatoRoot = new URL('../../mercato/', import.meta.url);

async function loadInventory() {
  const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
  assert.ok(
    Array.isArray(inventory.capabilities) && inventory.capabilities.length > 0,
    'surface-inventory.json must contain at least one capability row (a missing/empty inventory must fail loudly, not vacuously pass)',
  );
  return inventory.capabilities;
}

function extractDocumentedCapabilityIds(pageSource) {
  const ids = new Set();
  const pattern = /`([a-z][a-z0-9]*(?:\.[a-z0-9-]+)+)`<br\/>/g;
  for (const match of pageSource.matchAll(pattern)) {
    ids.add(match[1]);
  }
  return ids;
}

function extractLinkedSourcePaths(pageSource) {
  const paths = new Set();
  const blobPrefix = 'https://github.com/open-mercato/open-mercato/blob/develop/apps/mercato/';
  const pattern = /\]\((https:\/\/github\.com\/open-mercato\/open-mercato\/blob\/develop\/apps\/mercato\/[^)]+)\)/g;
  for (const match of pageSource.matchAll(pattern)) {
    const [pathOnly] = match[1].slice(blobPrefix.length).split('#');
    paths.add(pathOnly);
  }
  return paths;
}

test('reference-example-module.mdx covers every canonical example capability', async () => {
  const capabilities = await loadInventory();
  const pageSource = await readFile(pageUrl, 'utf8');
  const documentedIds = extractDocumentedCapabilityIds(pageSource);

  const canonicalIds = capabilities
    .filter((c) => c.coverageKind === 'example' && c.referenceStatus === 'canonical')
    .map((c) => c.capabilityId);

  const missing = canonicalIds.filter((id) => !documentedIds.has(id));
  assert.deepEqual(
    missing,
    [],
    `capability ids present in surface-inventory.json but missing from the docs page: ${missing.join(', ')}`,
  );
});

test('reference-example-module.mdx never references a capability id that no longer exists', async () => {
  const capabilities = await loadInventory();
  const pageSource = await readFile(pageUrl, 'utf8');
  const documentedIds = extractDocumentedCapabilityIds(pageSource);
  const knownIds = new Set(capabilities.map((c) => c.capabilityId));

  const stale = [...documentedIds].filter((id) => !knownIds.has(id));
  assert.deepEqual(
    stale,
    [],
    `docs page references capability id(s) no longer present in surface-inventory.json: ${stale.join(', ')}`,
  );
});

test('reference-example-module.mdx links only source paths that exist on disk', async () => {
  const pageSource = await readFile(pageUrl, 'utf8');
  const linkedPaths = extractLinkedSourcePaths(pageSource);

  assert.ok(linkedPaths.size > 0, 'the docs page must link at least one source path');

  const missing = [...linkedPaths].filter((relativePath) => {
    const absolutePath = resolve(fileURLToPath(mercatoRoot), relativePath);
    return !existsSync(absolutePath);
  });
  assert.deepEqual(
    missing,
    [],
    `docs page links source path(s) that do not exist under apps/mercato/ — check for a doubled path segment or a renamed file: ${missing.join(', ')}`,
  );
});

test('reference-example-module.mdx keeps the QA-only capability distinctly marked, never as a copyable pattern', async () => {
  const capabilities = await loadInventory();
  const pageSource = await readFile(pageUrl, 'utf8');

  const qaOnlyIds = capabilities.filter((c) => c.readStatus === 'qa-only').map((c) => c.capabilityId);
  assert.ok(qaOnlyIds.length > 0, 'expected at least one qa-only capability in the inventory (testing.integration-coverage)');

  for (const id of qaOnlyIds) {
    const idIndex = pageSource.indexOf(`\`${id}\``);
    assert.notEqual(idIndex, -1, `qa-only capability id \`${id}\` must be rendered on the page`);

    const nearbyWindow = pageSource.slice(Math.max(0, idIndex - 400), idIndex + 400);
    assert.match(
      nearbyWindow,
      /QA-only/,
      `qa-only capability \`${id}\` must be rendered next to a "QA-only" marker, not commingled with the readable rows`,
    );
  }
});

test('reference-example-module.mdx documents the disabled-by-default activation steps', async () => {
  const pageSource = await readFile(pageUrl, 'utf8');

  assert.match(
    pageSource,
    /\{\s*id:\s*'example',\s*from:\s*'@app'\s*\}/,
    'page must show the exact activation snippet for enabling `example` in `src/modules.ts`',
  );
  assert.match(pageSource, /yarn generate/, 'page must mention `yarn generate` as an activation step');
  assert.match(pageSource, /yarn db:migrate/, 'page must mention `yarn db:migrate` as an activation step');
});
