import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { parseComposePsOutput, resolveRepoRoot } from '../compose.mjs'
import { hostTrustEnv, summarizeProbeResults, writeCaBundle } from '../certs.mjs'
import { DEFAULT_OPENCODE_BASE_IMAGE, DEFAULT_PORTS, resolveStackPorts } from '../constants.mjs'
import { addEnvValue, readEnvValue } from '../env-file.mjs'
import { StepBlocked, resolveOpencodeBaseImage, runSteps } from '../steps.mjs'

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makeFakeRepo() {
  const dir = makeTempDir('om-starter-repo-')
  fs.mkdirSync(path.join(dir, 'starters', 'docker'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'starters', 'docker', 'compose.infra.yml'), 'services: {}\n')
  return dir
}

test('resolveRepoRoot walks up to the compose marker and returns null outside a repo', () => {
  const repo = makeFakeRepo()
  const nested = path.join(repo, 'packages', 'starter', 'src')
  fs.mkdirSync(nested, { recursive: true })
  assert.equal(resolveRepoRoot(nested), repo)
  const outside = makeTempDir('om-starter-outside-')
  assert.equal(resolveRepoRoot(outside), null)
})

test('parseComposePsOutput accepts both NDJSON and array formats', () => {
  const ndjson = '{"Service":"postgres","State":"running"}\n{"Service":"redis","State":"exited"}'
  assert.equal(parseComposePsOutput(ndjson).length, 2)
  const array = '[{"Service":"postgres","State":"running"}]'
  assert.equal(parseComposePsOutput(array)[0].Service, 'postgres')
  assert.deepEqual(parseComposePsOutput(''), [])
})

test('addEnvValue is fill-missing-only and replaceEmpty fills bare placeholders', () => {
  const dir = makeTempDir('om-starter-env-')
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, 'EXISTING=keep\nEMPTY=\n')
  assert.equal(addEnvValue(envPath, 'EXISTING', 'overwrite'), false)
  assert.equal(readEnvValue(envPath, 'EXISTING'), 'keep')
  assert.equal(addEnvValue(envPath, 'EMPTY', 'filled', { replaceEmpty: true }), true)
  assert.equal(readEnvValue(envPath, 'EMPTY'), 'filled')
  assert.equal(addEnvValue(envPath, 'NEW', 'value'), true)
  assert.equal(readEnvValue(envPath, 'NEW'), 'value')
})

test('hostTrustEnv wires CA bundle, system CA flag, and corepack proxy fix', () => {
  const env = hostTrustEnv('/tmp/bundle.pem', { NODE_OPTIONS: '--max-old-space-size=2048', HTTPS_PROXY: 'http://proxy:8080' })
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/tmp/bundle.pem')
  assert.ok(env.NODE_OPTIONS.includes('--use-system-ca'))
  assert.ok(env.NODE_OPTIONS.includes('--max-old-space-size=2048'))
  assert.equal(env.NODE_USE_ENV_PROXY, '1')
  const noProxy = hostTrustEnv(null, {})
  assert.equal(noProxy.NODE_EXTRA_CA_CERTS, undefined)
  assert.equal(noProxy.NODE_USE_ENV_PROXY, undefined)
  assert.ok(noProxy.NODE_OPTIONS.includes('--use-system-ca'))
})

test('writeCaBundle merges company bundles and captured certs, returns null when empty', () => {
  const repo = makeFakeRepo()
  const companyBundle = path.join(repo, 'company-ca.pem')
  fs.writeFileSync(companyBundle, '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n')
  const bundlePath = writeCaBundle(repo, {
    companyBundles: [companyBundle],
    capturedPems: [{ fingerprint: 'FP', subject: 'Test Interception CA', pem: '-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----\n' }],
  })
  const content = fs.readFileSync(bundlePath, 'utf8')
  assert.ok(content.includes('AAA'))
  assert.ok(content.includes('BBB'))
  assert.ok(content.includes('Test Interception CA'))
  assert.equal(writeCaBundle(repo, { companyBundles: [], capturedPems: [] }), null)
})

test('summarizeProbeResults buckets probe outcomes', () => {
  const summary = summarizeProbeResults([
    { host: 'a', status: 'ok' },
    { host: 'b', status: 'intercepted' },
    { host: 'c', status: 'unreachable' },
  ])
  assert.equal(summary.clean.length, 1)
  assert.equal(summary.intercepted[0].host, 'b')
  assert.equal(summary.unreachable[0].host, 'c')
})

test('resolveStackPorts honors env overrides and falls back to defaults', () => {
  const repo = makeFakeRepo()
  const ports = resolveStackPorts(repo, { POSTGRES_PORT: '5433', APP_PORT: 'not-a-number' })
  assert.equal(ports.postgres, 5433)
  assert.equal(ports.app, DEFAULT_PORTS.app)
  assert.equal(ports.mcp, DEFAULT_PORTS.mcp)
})

function quietCtx(overrides = {}) {
  return { log: () => {}, flags: {}, company: { steps: { disable: [], extra: [] } }, ...overrides }
}

test('runSteps skips satisfied steps, applies unsatisfied ones, and stops on StepBlocked with guidance', async () => {
  const order = []
  const steps = [
    { id: 'done', title: 'Done', async check() { order.push('check:done'); return { ok: true, detail: 'ok' } }, async apply() { order.push('apply:done') } },
    { id: 'todo', title: 'Todo', async check() { return { ok: false, detail: '' } }, async apply() { order.push('apply:todo') } },
    { id: 'skipped', title: 'Skipped', appliesTo: () => false, async check() { order.push('check:skipped'); return { ok: false } } },
  ]
  const outcome = await runSteps(steps, quietCtx())
  assert.equal(outcome.ok, true)
  assert.deepEqual(order, ['check:done', 'apply:todo'])

  const blocked = await runSteps([
    { id: 'gate', title: 'Gate', async check() { throw new StepBlocked('gate', ['install the thing']) } },
    { id: 'never', title: 'Never', async check() { order.push('check:never'); return { ok: true } } },
  ], quietCtx())
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blockedStep, 'gate')
  assert.ok(!order.includes('check:never'))
})

test('runSteps reports step failures without throwing', async () => {
  const outcome = await runSteps([
    { id: 'boom', title: 'Boom', async check() { return { ok: false } }, async apply() { throw new Error('exploded') } },
  ], quietCtx())
  assert.equal(outcome.ok, false)
  assert.equal(outcome.failedStep, 'boom')
})

test('resolveOpencodeBaseImage: env wins, then .env, then the pinned default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-opencode-'))
  try {
    assert.equal(
      resolveOpencodeBaseImage(root, {}),
      DEFAULT_OPENCODE_BASE_IMAGE,
    )
    fs.writeFileSync(path.join(root, '.env'), 'OPENCODE_BASE_IMAGE=registry.corp/opencode-base:1.18.3\n')
    assert.equal(
      resolveOpencodeBaseImage(root, {}),
      'registry.corp/opencode-base:1.18.3',
    )
    assert.equal(
      resolveOpencodeBaseImage(root, { OPENCODE_BASE_IMAGE: 'override/base:2' }),
      'override/base:2',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
