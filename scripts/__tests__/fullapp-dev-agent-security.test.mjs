import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { devNull } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const composeFiles = [
  'starters/docker/compose.fullapp.dev.yml',
  'docker-compose.fullapp.dev.yml',
  'packages/create-app/template/docker-compose.fullapp.dev.yml',
]
const composeAvailable = spawnSync('docker', ['compose', 'version'], { timeout: 10000 }).status === 0

function resolveCompose(file, password, extraEnv = {}) {
  return spawnSync('docker', [
    'compose', '--env-file', devNull, '--project-directory', repoRoot,
    '--profile', '*', '-f', file, 'config', '--format', 'json',
  ], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      JWT_SECRET: 'test-only-compose-jwt-secret',
      ...(password ? { OPENCODE_PASSWORD: password } : {}),
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 20000,
  })
}

for (const file of composeFiles) {
  test(`${file} requires native server authentication and authenticates its healthcheck`, () => {
    const content = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.match(content, /OPENCODE_SERVER_PASSWORD:\s*\$\{OPENCODE_PASSWORD:\?/)
    assert.match(content, /OPENCODE_PASSWORD:\s*\$\{OPENCODE_PASSWORD:\?/)
    assert.match(content, /opencode:\$\$OPENCODE_SERVER_PASSWORD/)
  })

  test(`${file} refuses startup without a password`, { skip: !composeAvailable }, () => {
    const result = resolveCompose(file)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /OPENCODE_PASSWORD/)
  })

  test(`${file} resolves matching credentials and loopback ports`, { skip: !composeAvailable }, () => {
    const password = 'test-only-opencode-password'
    const result = resolveCompose(file, password)
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(result.stdout)
    assert.equal(config.services.opencode.environment.OPENCODE_SERVER_PASSWORD, password)
    assert.equal(config.services.app.environment.OPENCODE_PASSWORD, password)
    for (const service of Object.values(config.services)) {
      for (const port of service.ports ?? []) assert.equal(port.host_ip, '127.0.0.1')
    }
    assert.match(config.services.opencode.healthcheck.test.join(' '), /opencode:\${1,2}OPENCODE_SERVER_PASSWORD/)
  })
}

for (const file of [
  'starters/docker/compose.infra.yml',
  'docker-compose.yml',
  'packages/create-app/template/docker-compose.yml',
  'starters/docker/compose.fullapp.yml',
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]) {
  test(`${file} configures OpenCode server authentication when the service is enabled`, { skip: !composeAvailable }, () => {
    const password = 'test-only-opencode-password'
    const result = resolveCompose(file, password)
    assert.equal(result.status, 0, result.stderr)
    const { opencode, app } = JSON.parse(result.stdout).services
    assert.equal(opencode.environment.OPENCODE_SERVER_PASSWORD, password)
    if (app) {
      assert.equal(app.environment.OPENCODE_PASSWORD, password)
      assert.match(opencode.healthcheck.test.join(' '), /opencode:\${1,2}OPENCODE_SERVER_PASSWORD/)
    }
  })
}

for (const file of [
  ...composeFiles,
  'starters/docker/compose.fullapp.yml',
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]) {
  test(`${file} gives the MCP server and OpenCode the same explicit transport key`, { skip: !composeAvailable }, () => {
    const key = 'test-only-mcp-transport-key'
    const result = resolveCompose(file, 'test-only-opencode-password', { MCP_SERVER_API_KEY: key })
    assert.equal(result.status, 0, result.stderr)
    const { opencode, mcp } = JSON.parse(result.stdout).services
    assert.equal(opencode.environment.MCP_SERVER_API_KEY, key)
    assert.equal(mcp.environment.MCP_SERVER_API_KEY, key)
    assert.equal(mcp.environment.MCP_SERVER_API_KEY_FILE, opencode.environment.MCP_SERVER_API_KEY_FILE)
  })
}

test('the pinned OpenCode server refuses missing and incorrect Basic credentials', {
  skip: process.env.OM_TEST_OPENCODE_AUTH !== '1',
  timeout: 60000,
}, async () => {
  const image = 'docker.io/openmercatocom/open-mercato-opencode@sha256:1ccc9d47dd46234dd6a4ad914662a226c96a21413c0d286e61bcc248745917f7'
  const started = spawnSync('docker', [
    'run', '--detach', '--pull=never', '--network', 'none',
    '--name', `om-opencode-auth-${randomUUID()}`,
    '--env', 'OPENCODE_SERVER_PASSWORD=test-only-opencode-password',
    '--entrypoint', 'opencode', image, 'serve', '--hostname', '127.0.0.1',
  ], { encoding: 'utf8', timeout: 20000 })
  assert.equal(started.status, 0, started.stderr)
  const containerId = started.stdout.trim()
  assert.match(containerId, /^[a-f0-9]{64}$/)
  try {
    const request = (credentials) => spawnSync('docker', [
      'exec', containerId, 'curl', '--silent', '--max-time', '2',
      '--output', '/dev/null', '--write-out', '%{http_code}',
      ...(credentials ? ['--user', credentials] : []),
      'http://127.0.0.1:4096/global/health',
    ], { encoding: 'utf8', timeout: 5000 })
    let unauthenticated
    for (let attempt = 0; attempt < 30; attempt += 1) {
      unauthenticated = request()
      if (unauthenticated.stdout === '401') break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    assert.equal(unauthenticated.stdout, '401')
    assert.equal(request('opencode:incorrect-password').stdout, '401')
    assert.equal(request('opencode:test-only-opencode-password').stdout, '200')
  } finally {
    const removed = spawnSync('docker', ['rm', '--force', containerId], { encoding: 'utf8', timeout: 10000 })
    assert.equal(removed.status, 0, removed.stderr)
  }
})
