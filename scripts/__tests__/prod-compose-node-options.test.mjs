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

test('docker-compose.fullapp.yml NODE_OPTIONS default heap cap is at least 1024 MB', () => {
  const mb = extractDefaultHeapMb('docker-compose.fullapp.yml')
  assert.ok(mb !== null, 'NODE_OPTIONS not found in docker-compose.fullapp.yml — add NODE_OPTIONS: ${NODE_OPTIONS:---max-old-space-size=3072} to the app service environment')
  assert.ok(
    mb >= MIN_HEAP_MB,
    `Default heap cap is ${mb} MB — below the ${MIN_HEAP_MB} MB minimum needed for normal app operation; raise the default in docker-compose.fullapp.yml`
  )
})

test('create-app template docker-compose.fullapp.yml NODE_OPTIONS default heap cap is at least 1024 MB', () => {
  const mb = extractDefaultHeapMb('packages/create-app/template/docker-compose.fullapp.yml')
  assert.ok(mb !== null, 'NODE_OPTIONS not found in template docker-compose.fullapp.yml')
  assert.ok(
    mb >= MIN_HEAP_MB,
    `Template default heap cap is ${mb} MB — below the ${MIN_HEAP_MB} MB minimum; update packages/create-app/template/docker-compose.fullapp.yml`
  )
})
