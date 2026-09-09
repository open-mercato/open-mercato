#!/usr/bin/env node
/**
 * Enforce the Documents bundle budgets recorded in
 * `.ai/specs/2026-07-08-documents-collaborative-editor.md`:
 *
 *   - the documents LIST route must not ship the editor runtime at all,
 *   - each editor/template dynamic entry stays ≤ 750 KiB gzip.
 *
 * The package-local resilience tests only prove the *import shape* (that the editor is behind a
 * statically analyzable dynamic import). That cannot catch a dependency creeping into the shared
 * graph and inflating the real chunk, so this measures the built output instead.
 *
 * Route → chunk resolution comes from the per-route `*_client-reference-manifest.js` files Next
 * writes under `<buildRoot>/server/app`. Every backend page — the documents list included — is
 * served by the `/backend/[...slug]` catch-all, so the resolvable unit is that route's eager chunk
 * group (`entryJSFiles` plus the non-async client-module chunks), not one page. That group is a
 * superset of what the list route loads, which makes the check strictly conservative: a chunk the
 * list route pulls in eagerly is always in it, so an editor dependency creeping into the shared
 * graph fails here even while it stays under the size budget.
 *
 * It runs after `next build` and is a no-op when there is no build output, so a packages-only
 * build or a fresh checkout does not fail.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import {
  carriesDocumentsEditorRuntime,
  collectEagerRouteChunks,
  findMissingDocumentsBundleEvidence,
  isDocumentsListRouteClientModule,
  normalizeChunkPath,
  parseClientReferenceManifest,
} from './lib/documents-bundle-runtime.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_ROOTS = [
  path.resolve(ROOT, 'apps/mercato/.mercato/next'),
  path.resolve(ROOT, 'apps/mercato/.next'),
]

const EDITOR_ENTRY_BUDGET_BYTES = 750 * 1024
const CLIENT_REFERENCE_MANIFEST_SUFFIX = '_client-reference-manifest.js'

function findBuildRoot() {
  return BUILD_ROOTS.find((candidate) => fs.existsSync(path.join(candidate, 'BUILD_ID'))) ?? null
}

function collectFiles(dir, matches, acc) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, matches, acc)
    else if (matches(entry.name)) acc.push(full)
  }
  return acc
}

function toBuildRelativeChunkPath(buildRoot, file) {
  return normalizeChunkPath(path.relative(buildRoot, file).split(path.sep).join('/'))
}

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file)).byteLength
}

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function readAlwaysLoadedChunks(buildRoot) {
  const chunks = new Set()
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(buildRoot, 'build-manifest.json'), 'utf8'))
  } catch {
    return chunks
  }
  for (const file of [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])]) {
    chunks.add(normalizeChunkPath(file))
  }
  return chunks
}

function findListRouteLeaks(buildRoot, editorRuntimeChunks) {
  const manifestFiles = collectFiles(
    path.join(buildRoot, 'server', 'app'),
    (name) => name.endsWith(CLIENT_REFERENCE_MANIFEST_SUFFIX),
    [],
  )
  const alwaysLoadedChunks = readAlwaysLoadedChunks(buildRoot)
  const checkedRoutes = []
  const violations = []

  for (const manifestFile of manifestFiles) {
    let parsed
    try {
      parsed = parseClientReferenceManifest(fs.readFileSync(manifestFile, 'utf8'))
    } catch {
      continue
    }
    if (!parsed) continue
    const listModules = Object.keys(parsed.manifest?.clientModules ?? {}).filter(
      isDocumentsListRouteClientModule,
    )
    if (listModules.length === 0) continue

    const eagerChunks = collectEagerRouteChunks(parsed.manifest, isDocumentsListRouteClientModule)
    for (const chunk of alwaysLoadedChunks) eagerChunks.add(chunk)
    checkedRoutes.push({ route: parsed.route, chunkCount: eagerChunks.size })

    for (const chunk of eagerChunks) {
      if (!editorRuntimeChunks.has(chunk)) continue
      violations.push(
        `${parsed.route} eagerly loads ${chunk}, which carries the documents editor runtime`,
      )
    }
  }

  return { checkedRoutes, violations }
}

const buildRoot = findBuildRoot()
if (!buildRoot) {
  console.log('[documents:budgets] No Next.js build output found — skipping (run after `yarn build:app`).')
  process.exit(0)
}

const chunkFiles = collectFiles(path.join(buildRoot, 'static'), (name) => name.endsWith('.js'), [])

const violations = []
const editorChunks = []
const editorRuntimeChunks = new Set()

for (const file of chunkFiles) {
  let source
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const carriesEditorRuntime = carriesDocumentsEditorRuntime(source)
  if (!carriesEditorRuntime) continue

  const bytes = gzipSize(file)
  editorChunks.push({ file: path.relative(ROOT, file), bytes })
  editorRuntimeChunks.add(toBuildRelativeChunkPath(buildRoot, file))
  if (bytes > EDITOR_ENTRY_BUDGET_BYTES) {
    violations.push(
      `${path.relative(ROOT, file)} is ${formatKib(bytes)} gzip, over the ${formatKib(EDITOR_ENTRY_BUDGET_BYTES)} editor-entry budget`,
    )
  }
}

editorChunks.sort((a, b) => b.bytes - a.bytes)
if (editorChunks.length > 0) {
  console.log(`[documents:budgets] Measured ${editorChunks.length} editor-runtime chunk(s):`)
  for (const chunk of editorChunks.slice(0, 5)) {
    console.log(`  ${formatKib(chunk.bytes).padStart(12)}  ${chunk.file}`)
  }
}

const listRouteLeaks = findListRouteLeaks(buildRoot, editorRuntimeChunks)
if (listRouteLeaks.checkedRoutes.length === 0) {
  console.log(
    '[documents:budgets] No route hosting the documents list page found in the client reference manifests — list-route isolation not verified.',
  )
} else {
  for (const route of listRouteLeaks.checkedRoutes) {
    console.log(
      `[documents:budgets] Checked ${route.chunkCount} eagerly loaded chunk(s) on ${route.route}, which hosts the documents list page.`,
    )
  }
}
violations.push(...listRouteLeaks.violations)
violations.push(...findMissingDocumentsBundleEvidence({
  clientChunkCount: chunkFiles.length,
  editorRuntimeChunkCount: editorChunks.length,
  checkedRouteCount: listRouteLeaks.checkedRoutes.length,
}))

if (violations.length > 0) {
  console.error('[documents:budgets] Budget verification failed — missing evidence or a breach cannot pass silently:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log('[documents:budgets] All editor-runtime chunks are within budget and stay off the documents list route.')
