import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { synchronizeDirectory } from '../../scripts/synchronize-directory.mjs'

test('directory synchronization replaces stale entry shapes and prunes removed files', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'create-app-sync-directory-'))
  const source = join(root, 'source')
  const target = join(root, 'target')

  try {
    fs.mkdirSync(join(source, 'modules'), { recursive: true })
    fs.writeFileSync(join(source, 'manifest.json'), 'current manifest')
    fs.writeFileSync(join(source, 'modules', 'customers.md'), 'current facts')

    fs.mkdirSync(join(target, 'manifest.json'), { recursive: true })
    fs.writeFileSync(join(target, 'manifest.json', 'stale'), 'stale directory')
    fs.writeFileSync(join(target, 'modules'), 'stale file')
    fs.writeFileSync(join(target, 'removed.md'), 'stale output')

    synchronizeDirectory(source, target)

    assert.equal(fs.readFileSync(join(target, 'manifest.json'), 'utf8'), 'current manifest')
    assert.equal(fs.readFileSync(join(target, 'modules', 'customers.md'), 'utf8'), 'current facts')
    assert.equal(fs.existsSync(join(target, 'removed.md')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
