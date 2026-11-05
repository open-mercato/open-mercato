import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REDIS_CONFIGS = [
  'docker/redis/redis.conf',
  'packages/create-app/template/docker/redis/redis.conf',
]

for (const relPath of REDIS_CONFIGS) {
  test(`${relPath} disables key eviction for BullMQ`, () => {
    const content = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')

    assert.match(content, /^maxmemory-policy\s+noeviction\s*$/m)
    assert.doesNotMatch(content, /^maxmemory-policy\s+(?!noeviction\b)\S+/m)
  })
}
