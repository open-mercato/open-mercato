import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MIN_HEAP_MB = 1024

function extractDefaultHeapMb(relPath) {
  const content = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
  const match = content.match(/NODE_OPTIONS:---max-old-space-size=(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

test('compose.fullapp.yml NODE_OPTIONS default heap cap is at least 1024 MB', () => {
  const mb = extractDefaultHeapMb('starters/docker/compose.fullapp.yml')
  assert.notStrictEqual(mb, null, 'NODE_OPTIONS default not found in starters/docker/compose.fullapp.yml')
  assert.ok(
    mb >= MIN_HEAP_MB,
    `Default heap cap is ${mb} MB — below the ${MIN_HEAP_MB} MB minimum needed for normal app operation`
  )
})

test('create-app template docker-compose.fullapp.yml NODE_OPTIONS default heap cap is at least 1024 MB', () => {
  const mb = extractDefaultHeapMb('packages/create-app/template/docker-compose.fullapp.yml')
  assert.notStrictEqual(mb, null, 'NODE_OPTIONS default not found in template docker-compose.fullapp.yml')
  assert.ok(
    mb >= MIN_HEAP_MB,
    `Template default heap cap is ${mb} MB — below the ${MIN_HEAP_MB} MB minimum`
  )
})
