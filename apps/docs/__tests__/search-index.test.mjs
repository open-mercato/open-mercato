import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production build emits a non-empty docs search index', async () => {
  const searchIndexUrl = new URL('../build/search-index.json', import.meta.url);
  const searchIndex = JSON.parse(await readFile(searchIndexUrl, 'utf8'));

  assert.ok(Array.isArray(searchIndex), 'search index must contain language buckets');
  const indexedDocuments = searchIndex.flatMap((bucket) =>
    Array.isArray(bucket?.documents) ? bucket.documents : [],
  );

  assert.ok(indexedDocuments.length > 0, 'search index must contain searchable documents');
  assert.ok(
    indexedDocuments.some((document) => document.u === '/introduction/use-cases'),
    'search index must contain the introduction page',
  );
});
