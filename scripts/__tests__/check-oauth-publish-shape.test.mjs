import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkResolvedFile, sourceCandidatesFor } from '../check-oauth-publish-shape.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'check-oauth-publish-shape.mjs')

function makePackage(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-publish-shape-')))
  for (const file of files) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '')
  }
  return { root, distDir: path.join(root, 'dist') }
}

test('accepts a dist file whose source exists, as .ts or .tsx', () => {
  const { root, distDir } = makePackage(['dist/lib/a.js', 'src/lib/a.ts', 'dist/lib/b.js', 'src/lib/b.tsx'])
  try {
    assert.equal(checkResolvedFile(path.join(distDir, 'lib/a.js'), distDir), null)
    assert.equal(checkResolvedFile(path.join(distDir, 'lib/b.js'), distDir), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a stale dist file left over after its source was renamed or deleted', () => {
  const { root, distDir } = makePackage(['dist/lib/old-name.js', 'src/lib/new-name.ts'])
  try {
    assert.match(checkResolvedFile(path.join(distDir, 'lib/old-name.js'), distDir) ?? '', /stale dist file with no source/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a missing file and a file outside the dist', () => {
  const { root, distDir } = makePackage(['dist/index.js', 'src/lib/outside.ts', 'lib/outside.js'])
  try {
    assert.match(checkResolvedFile(path.join(distDir, 'lib/missing.js'), distDir) ?? '', /missing file/)
    assert.match(checkResolvedFile(path.join(root, 'lib/outside.js'), distDir) ?? '', /outside the built dist/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('maps a dist file to its source candidates under src', () => {
  const distDir = path.join(path.sep, 'pkg', 'dist')
  assert.deepEqual(
    sourceCandidatesFor(path.join(distDir, 'lib', 'db', 'advisoryLock.js'), distDir).slice(0, 2),
    [path.join(path.sep, 'pkg', 'src', 'lib', 'db', 'advisoryLock.ts'), path.join(path.sep, 'pkg', 'src', 'lib', 'db', 'advisoryLock.tsx')],
  )
})

test('importing the checker does not run it', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(SCRIPT)})`], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
