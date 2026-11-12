import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))
const composeBin = process.env.DOCKER_COMPOSE_BIN || 'docker'
const composeArgs = process.env.DOCKER_COMPOSE_BIN ? [] : ['compose']
const version = spawnSync(composeBin, [...composeArgs, 'version', '--short'], {
  encoding: 'utf8',
  timeout: 30_000,
})
const skipReason = (version.error?.code === 'ENOENT' || version.status !== 0) && !process.env.DOCKER_COMPOSE_BIN
  ? 'Docker Compose is unavailable; set DOCKER_COMPOSE_BIN to a standalone Compose binary'
  : false

function registryPorts(composeFile, overrides) {
  const result = spawnSync(composeBin, [
    ...composeArgs,
    '--project-directory', rootDir,
    '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null',
    '--profile', 'registry',
    '-f', composeFile,
    'config', '--format', 'json',
  ], {
    cwd: rootDir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      SystemRoot: process.env.SystemRoot,
      ...overrides,
    },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  return JSON.parse(result.stdout).services.verdaccio.ports
}

for (const composeFile of ['starters/docker/compose.infra.yml', 'docker-compose.yml']) {
  test(`${composeFile} keeps anonymous registry uploads on loopback unless explicitly overridden`, { skip: skipReason }, () => {
    for (const overrides of [
      {},
      { VERDACCIO_PORT: '14873' },
      { VERDACCIO_HOST: '192.0.2.10', VERDACCIO_PORT: '14874' },
    ]) {
      const ports = registryPorts(composeFile, overrides)
      assert.equal(ports.length, 1)
      assert.equal(ports[0].host_ip, overrides.VERDACCIO_HOST || '127.0.0.1')
      assert.equal(ports[0].published, overrides.VERDACCIO_PORT || '4873')
      assert.equal(ports[0].target, 4873)
      assert.equal(ports[0].protocol, 'tcp')
    }
  })
}
