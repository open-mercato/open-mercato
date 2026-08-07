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
 * It runs after `next build` and is a no-op when there is no build output, so a packages-only
 * build or a fresh checkout does not fail.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { carriesDocumentsEditorRuntime } from './lib/documents-bundle-runtime.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_ROOTS = [
  path.resolve(ROOT, 'apps/mercato/.mercato/next'),
  path.resolve(ROOT, 'apps/mercato/.next'),
]

const EDITOR_ENTRY_BUDGET_BYTES = 750 * 1024

function findBuildRoot() {
  return BUILD_ROOTS.find((candidate) => fs.existsSync(path.join(candidate, 'BUILD_ID'))) ?? null
}

function collectChunkFiles(dir, acc) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectChunkFiles(full, acc)
    else if (entry.name.endsWith('.js')) acc.push(full)
  }
  return acc
}

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file)).byteLength
}

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

const buildRoot = findBuildRoot()
if (!buildRoot) {
  console.log('[documents:budgets] No Next.js build output found — skipping (run after `yarn build:app`).')
  process.exit(0)
}

const chunkFiles = collectChunkFiles(path.join(buildRoot, 'static'), [])
if (chunkFiles.length === 0) {
  console.log('[documents:budgets] No client chunks found — skipping.')
  process.exit(0)
}

const violations = []
const editorChunks = []

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
  if (bytes > EDITOR_ENTRY_BUDGET_BYTES) {
    violations.push(
      `${path.relative(ROOT, file)} is ${formatKib(bytes)} gzip, over the ${formatKib(EDITOR_ENTRY_BUDGET_BYTES)} editor-entry budget`,
    )
  }
}

if (editorChunks.length === 0) {
  console.log('[documents:budgets] No editor-runtime chunks found in the build output.')
  process.exit(0)
}

editorChunks.sort((a, b) => b.bytes - a.bytes)
console.log(`[documents:budgets] Measured ${editorChunks.length} editor-runtime chunk(s):`)
for (const chunk of editorChunks.slice(0, 5)) {
  console.log(`  ${formatKib(chunk.bytes).padStart(12)}  ${chunk.file}`)
}

if (violations.length > 0) {
  console.error('[documents:budgets] Budget breach — a breach requires an explicit spec update, not a silent regression:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log('[documents:budgets] All editor-runtime chunks are within budget.')
