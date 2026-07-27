import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production build emits a non-empty docs search index', async () => {
  const searchIndexUrl = new URL('../build/search-index.json', import.meta.url);
  const searchIndex = JSON.parse(await readFile(searchIndexUrl, 'utf8'));

  assert.equal(typeof searchIndex, 'object');
  assert.notEqual(searchIndex, null);
  assert.ok(Object.keys(searchIndex).length > 0);
});
