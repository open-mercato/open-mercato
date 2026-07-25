import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const RUNTIME_FILES = [
  'apps/mercato/scripts/dev.mjs',
  'packages/create-app/template/scripts/dev-runtime.mjs',
]

const BARE_DEREF = /externalSignal\.[A-Za-z_$]/g
const GUARDED_REASON = /externalSignal\?\.reason\s*\?\?\s*new Error\('warmup request aborted'\)/g

function readRuntimeFile(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

for (const relPath of RUNTIME_FILES) {
  test(`${relPath} never dereferences the nullable externalSignal without optional chaining`, () => {
    const content = readRuntimeFile(relPath)
    const bareReads = content.match(BARE_DEREF) ?? []
    assert.deepEqual(
      bareReads,
      [],
      `Found bare externalSignal member access in ${relPath}: ${bareReads.join(', ')}. ` +
        `externalSignal defaults to null, so every read must use optional chaining (externalSignal?.x) to avoid a TypeError.`,
    )
  })

  test(`${relPath} keeps the abort-reason fallback null-safe`, () => {
    const content = readRuntimeFile(relPath)
    const guarded = content.match(GUARDED_REASON) ?? []
    assert.equal(
      guarded.length,
      2,
      `Expected both abort paths in ${relPath} to read externalSignal?.reason with the error fallback, found ${guarded.length}.`,
    )
  })
}

test('app dev runtime and create-app template mirror share identical externalSignal abort handling', () => {
  const [appContent, templateContent] = RUNTIME_FILES.map(readRuntimeFile)
  const extractBlock = (content) => {
    const start = content.indexOf('async function fetchWithTimeout(')
    assert.notEqual(start, -1, 'fetchWithTimeout not found')
    const end = content.indexOf('\n}', start)
    assert.notEqual(end, -1, 'fetchWithTimeout end not found')
    return content.slice(start, end)
  }
  assert.equal(
    extractBlock(appContent),
    extractBlock(templateContent),
    'fetchWithTimeout must stay byte-identical between dev.mjs and the create-app template mirror (template-sync no-op).',
  )
})
