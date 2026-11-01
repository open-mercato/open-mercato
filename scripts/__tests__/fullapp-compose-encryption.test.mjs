import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const productionFiles = [
  'starters/docker/compose.fullapp.yml',
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]
const consumers = ['app', 'mcp', 'documents-collab']
const cleanEnv = { PATH: process.env.PATH, JWT_SECRET: randomBytes(32).toString('hex'), APP_URL: 'https://app.example.test' }
const dockerAvailable = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 10_000 }).status === 0
const publishedDevelopmentKey = fs.readFileSync(path.join(root, 'starters/docker/compose.fullapp.dev.yml'), 'utf8')
  .match(/TENANT_DATA_ENCRYPTION_FALLBACK_KEY:\s*\$\{TENANT_DATA_ENCRYPTION_FALLBACK_KEY:-([^}]+)\}/)?.[1]

function render(filename, overrides = {}) {
  return spawnSync('docker', ['compose', '--project-directory', root, '--env-file', '/dev/null', '-f',
    path.join(root, filename), '--profile', 'agents', '--profile', 'documents-collab', 'config', '--format', 'json'], {
    env: { ...cleanEnv, ...overrides }, encoding: 'utf8', timeout: 10_000,
  })
}

function rendered(filename, overrides) {
  const result = render(filename, overrides)
  assert.equal(result.status, 0, 'Compose must render the configured stack')
  return JSON.parse(result.stdout)
}

function preflight(config) {
  const service = config.services['encryption-preflight']
  return spawnSync(process.execPath, [...service.entrypoint.slice(1), ...service.command], {
    env: { PATH: process.env.PATH, ...service.environment }, encoding: 'utf8', timeout: 10_000,
  })
}

for (const filename of productionFiles) {
  test(`${filename}: missing or incomplete encryption configuration fails the startup preflight`, { skip: !dockerAvailable }, () => {
    for (const overrides of [{}, { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '', TENANT_DATA_ENCRYPTION_KEY: '' },
      { VAULT_ADDR: 'https://vault.example.test' }, { VAULT_TOKEN: randomBytes(32).toString('hex') },
      { TENANT_DATA_ENCRYPTION: 'false' }]) {
      const config = rendered(filename, overrides)
      const result = preflight(config)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /supply a tenant encryption key or both VAULT_ADDR and VAULT_TOKEN/)
    }
  })

  for (const variable of ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'TENANT_DATA_ENCRYPTION_KEY']) {
    test(`${filename}: operator ${variable} reaches every consumer unchanged`, { skip: !dockerAvailable }, () => {
      const key = randomBytes(32).toString('hex')
      const pepper = randomBytes(32).toString('hex')
      const config = rendered(filename, { [variable]: key, LOOKUP_HASH_PEPPER: pepper })
      assert.equal(preflight(config).status, 0)
      const service = config.services['encryption-preflight']
      assert.equal(service.image, config.services.app.image)
      for (const name of consumers) {
        const consumer = config.services[name]
        assert.deepEqual(consumer.depends_on['encryption-preflight'], { condition: 'service_completed_successfully', required: true })
        assert.equal(consumer.environment[variable], key)
        assert.equal(consumer.environment[variable === 'TENANT_DATA_ENCRYPTION_KEY'
          ? 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY' : 'TENANT_DATA_ENCRYPTION_KEY'], '')
        assert.equal(consumer.environment.LOOKUP_HASH_PEPPER, pepper)
        for (const [envName, envValue] of Object.entries(service.environment)) {
          assert.equal(consumer.environment[envName], envValue, `${name} must share ${envName} with the preflight`)
        }
      }
    })
  }

  test(`${filename}: configured Vault works without injecting credentials into a derived key`, { skip: !dockerAvailable }, () => {
    const settings = { VAULT_ADDR: 'https://vault.example.test', VAULT_TOKEN: randomBytes(32).toString('hex'),
      VAULT_KV_PATH: 'tenant-keys/data', VAULT_REQUEST_TIMEOUT_MS: '2500', VAULT_RECOVERY_COOLDOWN_MS: '5000',
      LOOKUP_HASH_PEPPER: randomBytes(32).toString('hex') }
    const config = rendered(filename, settings)
    assert.equal(preflight(config).status, 0)
    for (const name of consumers) {
      const environment = config.services[name].environment
      for (const [envName, value] of Object.entries(settings)) assert.equal(environment[envName], value)
      assert.equal(environment.TENANT_DATA_ENCRYPTION_FALLBACK_KEY, '')
      assert.equal(environment.TENANT_DATA_ENCRYPTION_KEY, '')
    }
  })

  test(`${filename}: unsafe keys fail the executed startup preflight without leaking values`, { skip: !dockerAvailable }, () => {
    assert.ok(publishedDevelopmentKey)
    for (const key of [' ', 'short-test-key', "''", publishedDevelopmentKey]) {
      const config = rendered(filename, { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: key })
      const result = preflight(config)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Tenant encryption configuration:/)
      if (key.trim() && key !== "''") assert.ok(!result.stderr.includes(key))
      assert.equal(result.stdout, '')
    }
  })

  test(`${filename}: invalid Vault address and effective fallback precedence fail safely`, { skip: !dockerAvailable }, () => {
    const token = randomBytes(32).toString('hex')
    const invalid = rendered(filename, { VAULT_ADDR: 'not-a-vault-url', VAULT_TOKEN: token })
    assert.notEqual(preflight(invalid).status, 0)
    const precedence = rendered(filename, { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'short',
      TENANT_DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex') })
    assert.notEqual(preflight(precedence).status, 0)
    const normalized = rendered(filename, { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: ` '${randomBytes(32).toString('hex')}' ` })
    assert.equal(preflight(normalized).status, 0)
  })

  test(`${filename}: Vault-only deployments require a strong dedicated lookup pepper`, { skip: !dockerAvailable }, () => {
    const vault = { VAULT_ADDR: 'https://vault.example.test', VAULT_TOKEN: randomBytes(32).toString('hex') }
    for (const pepper of ['', ' ', "''", 'weak-lookup-pepper', publishedDevelopmentKey]) {
      const result = preflight(rendered(filename, { ...vault, LOOKUP_HASH_PEPPER: pepper }))
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /lookup/)
      if (pepper && pepper.trim() && pepper !== "''") assert.ok(!result.stderr.includes(pepper))
    }
    assert.equal(preflight(rendered(filename, {
      ...vault, LOOKUP_HASH_PEPPER: randomBytes(32).toString('hex'),
    })).status, 0)
  })

  test(`${filename}: weak explicit peppers cannot override strong encryption keys`, { skip: !dockerAvailable }, () => {
    const key = randomBytes(32).toString('hex')
    for (const pepper of ['weak-lookup-pepper', publishedDevelopmentKey]) {
      const result = preflight(rendered(filename, { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: key, LOOKUP_HASH_PEPPER: pepper }))
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /lookup/)
      assert.ok(!result.stderr.includes(pepper))
    }
  })

  test(`${filename}: remote Vault requires TLS even when an encryption fallback is supplied`, { skip: !dockerAvailable }, () => {
    const settings = { VAULT_TOKEN: randomBytes(32).toString('hex'), LOOKUP_HASH_PEPPER: randomBytes(32).toString('hex') }
    for (const key of ['', randomBytes(32).toString('hex')]) {
      for (const host of ['vault.example.test', '10.0.0.1', 'localhost.example.test', '127.0.0.1.example.test']) {
        const result = preflight(rendered(filename, {
          ...settings, TENANT_DATA_ENCRYPTION_FALLBACK_KEY: key, VAULT_ADDR: `http://${host}:8200`,
        }))
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /HTTPS/)
        assert.ok(!result.stderr.includes(settings.VAULT_TOKEN))
      }
    }
    for (const address of ['https://vault.example.test', 'http://localhost:8200', 'http://127.0.0.1:8200', 'http://[::1]:8200']) {
      assert.equal(preflight(rendered(filename, { ...settings, VAULT_ADDR: address })).status, 0)
    }
  })
}

test('shipped env examples contain no tenant encryption key value', () => {
  for (const filename of ['apps/mercato/.env.example', 'packages/create-app/template/.env.example']) {
    const text = fs.readFileSync(path.join(root, filename), 'utf8')
    assert.match(text, /^TENANT_DATA_ENCRYPTION_FALLBACK_KEY=$/m)
    assert.match(text, /^TENANT_DATA_ENCRYPTION_KEY=$/m)
  }
})

test('Compose prevents a dependent application process from starting after a failed preflight', {
  skip: !dockerAvailable || !process.env.OM_COMPOSE_ENCRYPTION_TEST_IMAGE,
}, async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  for (const filename of productionFiles) {
    for (const configured of [false, true]) {
      const fixture = rendered(filename, configured
        ? { TENANT_DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex') } : {})
      const directory = mkdtempSync(path.join(tmpdir(), 'om-encryption-preflight-'))
      const composePath = path.join(directory, 'compose.json')
      const project = `om-encryption-test-${randomBytes(6).toString('hex')}`
      const image = process.env.OM_COMPOSE_ENCRYPTION_TEST_IMAGE
      const { networks, ...preflightConfiguration } = fixture.services['encryption-preflight']
      const preflightService = { ...preflightConfiguration, image, network_mode: 'none' }
      writeFileSync(composePath, JSON.stringify({ services: {
        'encryption-preflight': preflightService,
        app: { image, network_mode: 'none', depends_on: {
          'encryption-preflight': fixture.services.app.depends_on['encryption-preflight'],
        }, entrypoint: ['node', '-e'], command: ["console.log('application-probe-started')"] },
      } }))
      const args = ['compose', '--project-name', project, '-f', composePath]
      try {
        const result = spawnSync('docker', [...args, 'up', '--pull', 'never', '--abort-on-container-exit', '--exit-code-from', 'app'], {
          encoding: 'utf8', timeout: 30_000,
        })
        if (configured) {
          assert.equal(result.status, 0, `${filename}: configured preflight must allow the dependent process`)
          assert.match(result.stdout, /application-probe-started/)
        } else {
          assert.notEqual(result.status, 0)
          assert.doesNotMatch(result.stdout, /application-probe-started/)
          assert.match(result.stdout + result.stderr, /Tenant encryption configuration:/)
        }
      } finally {
        const cleanup = spawnSync('docker', [...args, 'down', '--volumes', '--remove-orphans'], { encoding: 'utf8', timeout: 30_000 })
        assert.equal(cleanup.status, 0, 'isolated test containers must be removed')
        rmSync(directory, { recursive: true, force: true })
      }
    }
  }
})
