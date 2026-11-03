import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { DEFAULT_OPENCODE_BASE_IMAGE } from '../constants.mjs'
import { startInfraServices, formatInfraProblem } from '../infra-preflight.mjs'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const composeFiles = ['starters/docker/compose.infra.yml', 'packages/create-app/template/docker-compose.yml']
const setupServices = ['postgres', 'redis', 'meilisearch']
const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', windowsHide: true })
const noCompose = docker.error || docker.status !== 0 ? 'Docker Compose is not installed; source guards still run' : false

function serviceBlock(text, service) {
  const match = text.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-z][a-z_]*:|^volumes:|^networks:|$(?![\\s\\S]))`, 'm'))
  assert.ok(match, `${service} must exist`)
  return match[0]
}

function resolvedConfig(file, env = {}, envFile) {
  const shellEnv = { ...process.env, OPENCODE_BASE_IMAGE: '', INFRA_BIND_HOST: '', ...env }
  if (envFile) delete shellEnv.REDIS_PASSWORD
  const result = spawnSync('docker', ['compose', '--project-directory', repoRoot, ...(envFile ? ['--env-file', envFile] : []), '-f', path.join(repoRoot, file), 'config', '--format', 'json'], {
    env: shellEnv,
    encoding: 'utf8', windowsHide: true,
  })
  assert.equal(result.status, 0, `${file}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

for (const file of composeFiles) {
  test(`${file} pins setup service images and defaults host ports to loopback`, () => {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    for (const service of setupServices) {
      const block = serviceBlock(text, service)
      assert.match(block, /image: \S+@sha256:[a-f0-9]{64}\s*\n/)
      assert.match(block, /ports:\n\s+- "\$\{INFRA_BIND_HOST:-127\.0\.0\.1\}:\$\{[A-Z_]+_PORT:-[0-9]+\}:[0-9]+"/)
    }
    assert.ok(serviceBlock(text, 'opencode').includes(DEFAULT_OPENCODE_BASE_IMAGE))
  })

  test(`${file} resolves PostgreSQL, Redis and Meilisearch bindings to 127.0.0.1`, { skip: noCompose }, () => {
    const config = resolvedConfig(file)
    for (const service of setupServices) {
      assert.ok(config.services[service].ports.length > 0)
      assert.ok(config.services[service].ports.every((port) => port.host_ip === '127.0.0.1'), `${service} must not publish to every interface`)
      assert.match(config.services[service].image, /@sha256:[a-f0-9]{64}$/)
    }
  })

  test(`${file} passes a literal dotenv Redis password as one argument and healthcheck env`, { skip: noCompose }, () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-compose-redis-'))
    const password = String.raw`pa$$word "quoted" \literal;$(never-execute)`
    const envFile = path.join(fixture, '.env')
    const dotEnv = `REDIS_PASSWORD='${password}'\n`
    fs.writeFileSync(envFile, dotEnv)
    try {
      assert.equal(parseEnv(dotEnv).REDIS_PASSWORD, password)
      const config = resolvedConfig(file, {}, envFile)
      const renderedPassword = password.replaceAll('$', () => '$$')
      assert.deepEqual(config.services.redis.command, ['redis-server', '/usr/local/etc/redis/redis.conf', '--maxmemory', '512mb', '--requirepass', renderedPassword])
      assert.equal(config.services.redis.environment.REDISCLI_AUTH, renderedPassword)
      assert.equal(config.services.redis.command.at(-1).replaceAll('$$', '$'), password)
      assert.equal(config.services.redis.environment.REDISCLI_AUTH.replaceAll('$$', '$'), password)
      assert.deepEqual(config.services.redis.healthcheck.test, ['CMD', 'redis-cli', 'ping'])
    } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
  })

  test(`${file} permits explicit operator host-binding override`, { skip: noCompose }, () => {
    const config = resolvedConfig(file, { INFRA_BIND_HOST: '192.0.2.10' })
    for (const service of setupServices) assert.equal(config.services[service].ports[0].host_ip, '192.0.2.10')
  })
}

test('OpenCode setup constants and build defaults retain the same pinned image', () => {
  assert.match(DEFAULT_OPENCODE_BASE_IMAGE, /@sha256:[a-f0-9]{64}$/)
  for (const file of ['docker/opencode/Dockerfile', 'packages/create-app/template/docker/opencode/Dockerfile']) {
    assert.ok(fs.readFileSync(path.join(repoRoot, file), 'utf8').includes(`ARG OPENCODE_BASE_IMAGE=${DEFAULT_OPENCODE_BASE_IMAGE}\n`))
  }
})


function preflightOptions(cwd, env, hooks = {}) {
  return {
    cwd, env,
    composeArgs: (extra) => ['compose', ...extra],
    services: [{ service: 'redis', envKey: 'REDIS_PORT', port: 6379 }],
    detect: () => ({ ok: true }),
    spawnSyncImpl: () => ({ status: 0, stdout: '' }),
    portProbe: async () => false,
    containerProbe: () => [],
    processProbe: () => [],
    log() {},
    ...hooks,
  }
}

test('nonlocal Redis without a password is rejected before every Docker call', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-infra-binding-'))
  try {
    fs.writeFileSync(path.join(fixture, '.env'), 'INFRA_BIND_HOST=0.0.0.0\nREDIS_PASSWORD=\n')
    let dockerCalls = 0
    const result = await startInfraServices(preflightOptions(fixture, {}, {
      detect() { dockerCalls += 1; return { ok: true } },
      spawnSyncImpl() { dockerCalls += 1; return { status: 0, stdout: '' } },
    }))
    assert.equal(result.ok, false)
    assert.equal(result.problem.code, 'unsafe-binding')
    assert.equal(dockerCalls, 0)
    const message = formatInfraProblem(result.problem, { output: { isTTY: false }, env: {} }).join('\n')
    assert.match(message, /REDIS_PASSWORD/)
    assert.match(message, /INFRA_BIND_HOST=127\.0\.0\.1/)
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})

test('shell binding and password values override dotenv while authenticated nonlocal Redis is allowed', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-infra-binding-'))
  try {
    fs.writeFileSync(path.join(fixture, '.env'), "INFRA_BIND_HOST=0.0.0.0\nREDIS_PASSWORD='configured password'\n")
    const accepted = await startInfraServices(preflightOptions(fixture, {}))
    assert.equal(accepted.ok, true)
    const rejected = await startInfraServices(preflightOptions(fixture, { REDIS_PASSWORD: '' }))
    assert.equal(rejected.problem.code, 'unsafe-binding')
    const local = await startInfraServices(preflightOptions(fixture, { INFRA_BIND_HOST: '127.0.0.1', REDIS_PASSWORD: '' }))
    assert.equal(local.ok, true)
    const shellPassword = await startInfraServices(preflightOptions(fixture, { INFRA_BIND_HOST: '::', REDIS_PASSWORD: 'authenticated' }))
    assert.equal(shellPassword.ok, true)
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})
