import assert from 'node:assert/strict'
import test from 'node:test'
import {
  carriesDocumentsEditorRuntime,
  collectEagerRouteChunks,
  DOCUMENTS_EDITOR_RUNTIME_MARKERS,
  isDocumentsListRouteClientModule,
  normalizeChunkPath,
  parseClientReferenceManifest,
} from '../lib/documents-bundle-runtime.mjs'

test('Documents bundle markers match package paths instead of incidental identifier substrings', () => {
  assert.equal(carriesDocumentsEditorRuntime('const yjsDocMap = new Map()'), false)
  assert.equal(
    carriesDocumentsEditorRuntime('node_modules/@lexical/react/LexicalCollaborationContext.prod.mjs'),
    false,
  )

  for (const marker of DOCUMENTS_EDITOR_RUNTIME_MARKERS) {
    assert.equal(carriesDocumentsEditorRuntime(`${marker}dist/index.js [app-client]`), true)
  }
})

test('List-route client modules exclude the editor route they must stay isolated from', () => {
  assert.equal(
    isDocumentsListRouteClientModule(
      '[project]/packages/documents/dist/modules/documents/backend/documents/DocumentsPageClient.js',
    ),
    true,
  )
  assert.equal(
    isDocumentsListRouteClientModule(
      '[project]/packages/documents/dist/modules/documents/backend/documents/templates/TemplatesPageClient.js',
    ),
    true,
  )
  assert.equal(
    isDocumentsListRouteClientModule(
      '[project]/packages/documents/dist/modules/documents/backend/documents/[id]/DocumentPageClient.js',
    ),
    false,
  )
  assert.equal(
    isDocumentsListRouteClientModule('[project]/packages/ui/dist/backend/AppShell.js'),
    false,
  )
})

test('Chunk paths from both manifest shapes normalize to one build-relative form', () => {
  assert.equal(normalizeChunkPath('/_next/static/chunks/a.js'), 'static/chunks/a.js')
  assert.equal(normalizeChunkPath('static/chunks/a.js'), 'static/chunks/a.js')
  assert.equal(normalizeChunkPath('_next/static/chunks/a.js'), 'static/chunks/a.js')
})

function manifestSource(route, manifest) {
  return [
    'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};',
    `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = ${JSON.stringify(manifest)};`,
    '',
  ].join('\n')
}

test('Client reference manifests parse into their route and payload', () => {
  const manifest = { clientModules: { 'a.js': { chunks: ['/_next/static/chunks/a.js'] } }, entryJSFiles: {} }
  const parsed = parseClientReferenceManifest(manifestSource('/(backend)/backend/[...slug]/page', manifest))
  assert.equal(parsed.route, '/(backend)/backend/[...slug]/page')
  assert.deepEqual(parsed.manifest, manifest)

  assert.equal(parseClientReferenceManifest('globalThis.__RSC_MANIFEST = {};\n'), null)
  assert.equal(
    parseClientReferenceManifest('globalThis.__RSC_MANIFEST["/x"] = {not json};\n'),
    null,
  )
})

test('Eager route chunks cover entry files and tracked sync modules, never async ones', () => {
  const chunks = collectEagerRouteChunks(
    {
      entryJSFiles: {
        '[project]/apps/mercato/src/app/(backend)/backend/[...slug]/page': ['static/chunks/entry.js'],
      },
      clientModules: {
        '[project]/packages/documents/dist/modules/documents/backend/documents/DocumentsPageClient.js': {
          async: false,
          chunks: ['/_next/static/chunks/list.js'],
        },
        '[project]/packages/documents/dist/modules/documents/backend/documents/LazyIsland.js': {
          async: true,
          chunks: ['/_next/static/chunks/lazy.js'],
        },
        '[project]/packages/ui/dist/backend/AppShell.js': {
          async: false,
          chunks: ['/_next/static/chunks/untracked.js'],
        },
      },
    },
    isDocumentsListRouteClientModule,
  )

  assert.deepEqual(
    [...chunks].sort(),
    ['static/chunks/entry.js', 'static/chunks/list.js'],
  )
})

test('Eager route chunks tolerate a manifest without client modules or entry files', () => {
  assert.deepEqual([...collectEagerRouteChunks({}, isDocumentsListRouteClientModule)], [])
})
