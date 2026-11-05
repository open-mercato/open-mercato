import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const COMPOSE_FILES = [
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]
const FORWARDED_VARIABLES = [
  'CONSENT_INTEGRITY_SECRET',
  'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
  'DB_POOL_ACQUIRE_TIMEOUT',
  'DB_POOL_IDLE_TIMEOUT',
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'NEXTAUTH_SECRET',
  'NEXT_PUBLIC_QUEUE_STRATEGY',
  'OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING',
  'OM_INSTANCE_COUNT',
  'OM_MULTI_INSTANCE',
  'QUEUE_REDIS_URL',
  'QUEUE_STRATEGY',
  'RATE_LIMIT_STRATEGY',
  'REDIS_URL',
]

function readAppService(relPath) {
  const content = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
  const appStart = content.indexOf('\n  app:')
  const nextService = content.indexOf('\n  postgres:', appStart)

  assert.notStrictEqual(appStart, -1, `${relPath} must define the app service`)
  assert.notStrictEqual(nextService, -1, `${relPath} must define a service after app`)

  return content.slice(appStart, nextService)
}

for (const relPath of COMPOSE_FILES) {
  test(`${relPath} forwards production runtime configuration into the app service`, () => {
    const appService = readAppService(relPath)

    for (const variable of FORWARDED_VARIABLES) {
      assert.match(
        appService,
        new RegExp(`^\\s+${variable}:\\s+\\$\\{${variable}(?=[:}])`, 'm'),
        `${relPath} must forward ${variable} into the app container`,
      )
    }
  })
}
