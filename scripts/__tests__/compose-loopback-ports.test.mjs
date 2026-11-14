import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Dev-infra stacks publish backing services with dev-default credentials.
// Docker-published ports bypass ufw/iptables INPUT rules on Linux, so every
// published port must bind to the loopback interface unless the operator opts
// in via INFRA_BIND_HOST, or VERDACCIO_HOST for the registry only (#6949).
const DEV_INFRA_COMPOSE_FILES = [
  'starters/docker/compose.infra.yml',
  'docker-compose.yml',
  'packages/create-app/template/docker-compose.yml',
]

const LOOPBACK_PREFIX = /^\$\{(?:INFRA_BIND_HOST|VERDACCIO_HOST):-127\.0\.0\.1\}:/

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

test('a bind override must default to the loopback interface', () => {
  assert.ok(LOOPBACK_PREFIX.test('${INFRA_BIND_HOST:-127.0.0.1}:${POSTGRES_PORT:-5432}:5432'))
  assert.ok(LOOPBACK_PREFIX.test('${VERDACCIO_HOST:-127.0.0.1}:${VERDACCIO_PORT:-4873}:4873'))
  assert.equal(LOOPBACK_PREFIX.test('${VERDACCIO_PORT:-4873}:4873'), false)
  assert.equal(LOOPBACK_PREFIX.test('${INFRA_BIND_HOST:-0.0.0.0}:${POSTGRES_PORT:-5432}:5432'), false)
  assert.equal(LOOPBACK_PREFIX.test('${VERDACCIO_HOST:-0.0.0.0}:${VERDACCIO_PORT:-4873}:4873'), false)
  assert.equal(LOOPBACK_PREFIX.test('0.0.0.0:${POSTGRES_PORT:-5432}:5432'), false)
})

// Verdaccio writes VERDACCIO_PUBLIC_URL into every dist.tarball URL, overriding
// the request host, and Yarn downloads tarballs from that URL. Moving only the
// listening address (VERDACCIO_HOST) would keep advertising
// localhost, so a container install would fetch tarballs from itself. The
// public URL must be overridable alongside the bind address.
const VERDACCIO_COMPOSE_FILES = ['starters/docker/compose.infra.yml', 'docker-compose.yml']

for (const file of VERDACCIO_COMPOSE_FILES) {
  test(`${file} lets the advertised Verdaccio tarball URL follow the registry route`, () => {
    const content = fs.readFileSync(path.resolve(ROOT, file), 'utf8')
    const publicUrls = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('VERDACCIO_PUBLIC_URL:'))
    assert.deepEqual(publicUrls, ['VERDACCIO_PUBLIC_URL: ${OM_VERDACCIO_PUBLIC_URL:-http://localhost:4873}'])
  })
}

test('the native-Linux registry route documents the root .env and the host VERDACCIO_URL export', () => {
  const readme = fs.readFileSync(path.resolve(ROOT, 'docker/README.md'), 'utf8')
  const section = readme.slice(readme.indexOf('### Local Verdaccio for standalone fullapp builds on native Linux'))
  assert.match(section, /`\.env` at the \*\*repository root\*\*/)
  assert.match(section, /VERDACCIO_HOST=172\.17\.0\.1/)
  assert.match(section, /OM_VERDACCIO_PUBLIC_URL=http:\/\/172\.17\.0\.1:4873/)
  assert.match(section, /export VERDACCIO_URL=http:\/\/172\.17\.0\.1:4873/)
  assert.doesNotMatch(section, /\.env next to the infra compose file/)
})
