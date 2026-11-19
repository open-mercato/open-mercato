import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const COMPOSE_BIN = process.env.DOCKER_COMPOSE_BIN || 'docker'
const COMPOSE_ARGS = process.env.DOCKER_COMPOSE_BIN ? [] : ['compose']
const composeVersion = spawnSync(COMPOSE_BIN, [...COMPOSE_ARGS, 'version', '--short'], {
  encoding: 'utf8',
  timeout: 30_000,
})
const composeUnavailable = composeVersion.error?.code === 'ENOENT' || composeVersion.status !== 0
const skipReason = composeUnavailable && !process.env.DOCKER_COMPOSE_BIN
  ? 'Docker Compose is unavailable; set DOCKER_COMPOSE_BIN to a standalone Compose 2.24.4+ binary'
  : false

function composeConfig(files, env = {}, collaborationEnabled = true) {
  const result = spawnSync(COMPOSE_BIN, [
    ...COMPOSE_ARGS,
    '--project-directory', ROOT,
    '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null',
    ...(collaborationEnabled ? ['--profile', 'documents-collab'] : []),
    ...files.flatMap(file => ['-f', file]),
    'config', '--format', 'json',
  ], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: os.tmpdir(),
      USERPROFILE: os.tmpdir(),
      JWT_SECRET: 'compose-regression-jwt-secret-not-for-deployment',
      DOMAIN_CHECK_SECRET: 'compose-regression-domain-secret-not-for-deployment',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  return JSON.parse(result.stdout)
}

for (const directory of ['starters/docker', '.']) {
  for (const mode of ['production', 'development']) {
    const prefix = directory === '.' ? 'docker-compose' : `${directory}/compose`
    const base = `${prefix}.fullapp${mode === 'development' ? '.dev' : ''}.yml`
    const files = [base, `${prefix}.fullapp.traefik.yml`]
    if (mode === 'development') files.push(`${prefix}.fullapp.traefik.dev.yml`)

    test(`${directory} ${mode} Traefik merge keeps application ports private`, { skip: skipReason }, () => {
      for (const env of [
        {},
        { APP_PORT: '8300', ...(mode === 'production' ? { CONTAINER_PORT: '3300' } : { OM_DEV_SPLASH_PORT: '4300' }), DOCUMENTS_COLLAB_PORT: '4401', TRAEFIK_HTTP_PORT: '8080', TRAEFIK_HTTPS_PORT: '8443' },
      ]) {
        const config = composeConfig(files, env)
        const { app, traefik, 'documents-collab': collaboration } = config.services
        assert.deepEqual(app.ports ?? [], [])
        assert.deepEqual(collaboration.ports ?? [], [])
        assert.deepEqual(collaboration.profiles, ['documents-collab'])
        const network = Object.keys(traefik.networks).find(name => name in app.networks)
        assert.ok(network, 'Traefik must share a network with the app')
        assert.ok(network in collaboration.networks, 'Collaboration must remain reachable by its proxy')
        const containerPort = env.CONTAINER_PORT || '3000'
        assert.equal(app.environment.PORT, containerPort)
        assert.equal(app.labels['traefik.http.services.app-upstream.loadbalancer.server.port'], containerPort)
        assert.equal(app.labels['traefik.http.middlewares.domain-check.forwardauth.address'], `http://app:${containerPort}/api/customer_accounts/domain-check`)
        assert.equal(app.labels['traefik.http.routers.customer.middlewares'], 'inject-domain-check-secret,domain-check')
        assert.equal(app.labels['traefik.http.routers.customer.entrypoints'], 'websecure')
        assert.equal(app.labels['traefik.http.routers.customer.tls'], 'true')
        assert.deepEqual(traefik.ports.map(port => [port.published, port.target]), [
          [env.TRAEFIK_HTTP_PORT || '80', 80],
          [env.TRAEFIK_HTTPS_PORT || '443', 443],
        ])
      }
    })

    test(`${directory} ${mode} base retains deliberate direct/external-proxy access`, { skip: skipReason }, () => {
      const config = composeConfig([base], { APP_PORT: '8300', CONTAINER_PORT: '3300', DOCUMENTS_COLLAB_PORT: '4401' })
      assert.ok(config.services.app.ports.some(port => port.published === '8300' && port.target === (mode === 'production' ? 3300 : 3000)))
      assert.ok(config.services['documents-collab'].ports.some(port => port.published === '4401' && port.target === 4401))
      assert.equal(config.services.traefik, undefined)
    })
  }
}

test('collaboration stays disabled without its profile', { skip: skipReason }, () => {
  const config = composeConfig([
    'starters/docker/compose.fullapp.yml',
    'starters/docker/compose.fullapp.traefik.yml',
  ], {}, false)
  assert.equal(config.services['documents-collab'], undefined)
  assert.deepEqual(config.services.app.ports ?? [], [])
})

test('a final operator override can publish only loopback ports with bundled Traefik', { skip: skipReason }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-traefik-ports-'))
  const override = path.join(directory, 'compose.loopback.yml')
  try {
    fs.writeFileSync(override, `services:
  app:
    ports: !override
      - "127.0.0.1:8300:3300"
  documents-collab:
    ports: !override
      - "127.0.0.1:4401:4401"
`)
    const config = composeConfig([
      'starters/docker/compose.fullapp.yml',
      'starters/docker/compose.fullapp.traefik.yml',
      override,
    ], { CONTAINER_PORT: '3300', DOCUMENTS_COLLAB_PORT: '4401' })
    for (const [name, published, target] of [['app', '8300', 3300], ['documents-collab', '4401', 4401]]) {
      assert.equal(config.services[name].ports.length, 1)
      assert.equal(config.services[name].ports[0].host_ip, '127.0.0.1')
      assert.equal(config.services[name].ports[0].published, published)
      assert.equal(config.services[name].ports[0].target, target)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('the documented collaboration WSS overlay routes internally without publishing ports', { skip: skipReason }, () => {
  const readme = fs.readFileSync(path.join(ROOT, 'docker/traefik/README.md'), 'utf8')
  const example = readme.match(/```yaml\n# compose\.collab\.local\.yml\n([\s\S]+?)\n```/)
  assert.ok(example, 'The collaboration proxy example must be documented')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-traefik-wss-'))
  const override = path.join(directory, 'compose.collab.local.yml')
  try {
    fs.writeFileSync(override, example[1])
    const config = composeConfig([
      'starters/docker/compose.fullapp.yml',
      'starters/docker/compose.fullapp.traefik.yml',
      override,
    ], { DOCUMENTS_COLLAB_PORT: '4401' })
    const collaboration = config.services['documents-collab']
    assert.deepEqual(collaboration.ports ?? [], [])
    assert.equal(collaboration.labels['traefik.http.routers.documents-collab.entrypoints'], 'websecure')
    assert.equal(collaboration.labels['traefik.http.routers.documents-collab.tls'], 'true')
    assert.equal(collaboration.labels['traefik.http.services.documents-collab.loadbalancer.server.port'], '4401')
    assert.ok(Object.keys(config.services.traefik.networks).some(name =>
      name in collaboration.networks && config.networks[name].name === collaboration.labels['traefik.docker.network'],
    ))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
