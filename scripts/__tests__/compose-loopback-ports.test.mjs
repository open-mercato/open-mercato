import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Dev-infra stacks publish backing services with dev-default credentials.
// Docker-published ports bypass ufw/iptables INPUT rules on Linux, so every
// published port must bind to the loopback interface unless the operator opts
// in via OM_DOCKER_BIND_ADDRESS, or a per-service OM_<SERVICE>_BIND_ADDRESS that
// falls back to it (#6949).
const DEV_INFRA_COMPOSE_FILES = [
  'starters/docker/compose.infra.yml',
  'docker-compose.yml',
  'packages/create-app/template/docker-compose.yml',
]

const LOOPBACK_DEFAULT = '${OM_DOCKER_BIND_ADDRESS:-127.0.0.1}'
const LOOPBACK_PREFIX = new RegExp(
  `^(?:\\$\\{OM_[A-Z]+_BIND_ADDRESS:-${escapeRegExp(LOOPBACK_DEFAULT)}\\}|${escapeRegExp(LOOPBACK_DEFAULT)}):`,
)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function publishedPortEntries(content) {
  const entries = []
  let inPorts = false
  let portsIndent = -1
  for (const line of content.split(/\r?\n/)) {
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (trimmed === 'ports:') {
      inPorts = true
      portsIndent = indent
      continue
    }
    if (!inPorts) continue
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (indent <= portsIndent || !trimmed.startsWith('- ')) {
      inPorts = false
      continue
    }
    entries.push(trimmed.slice(2).replace(/^["']|["']$/g, ''))
  }
  return entries
}

for (const file of DEV_INFRA_COMPOSE_FILES) {
  test(`${file} publishes every port on the loopback interface by default`, () => {
    const content = fs.readFileSync(path.resolve(ROOT, file), 'utf8')
    const entries = publishedPortEntries(content)
    assert.ok(entries.length > 0, `${file} publishes no ports — the parser no longer matches the file`)
    const exposed = entries.filter((entry) => !LOOPBACK_PREFIX.test(entry))
    assert.deepEqual(exposed, [], `${file} publishes ports on all interfaces: ${exposed.join(', ')}`)
  })
}

test('a per-service bind override must fall back to the loopback default', () => {
  assert.ok(LOOPBACK_PREFIX.test('${OM_DOCKER_BIND_ADDRESS:-127.0.0.1}:${POSTGRES_PORT:-5432}:5432'))
  assert.ok(
    LOOPBACK_PREFIX.test('${OM_VERDACCIO_BIND_ADDRESS:-${OM_DOCKER_BIND_ADDRESS:-127.0.0.1}}:${VERDACCIO_PORT:-4873}:4873'),
  )
  assert.equal(LOOPBACK_PREFIX.test('${VERDACCIO_PORT:-4873}:4873'), false)
  assert.equal(LOOPBACK_PREFIX.test('${OM_VERDACCIO_BIND_ADDRESS:-0.0.0.0}:${VERDACCIO_PORT:-4873}:4873'), false)
  assert.equal(LOOPBACK_PREFIX.test('0.0.0.0:${POSTGRES_PORT:-5432}:5432'), false)
})
