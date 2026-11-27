import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const version = '0.10.1-develop.8193.1.a0ebde7427'
const tarball = `https://registry.npmjs.org/@open-mercato/core/-/core-${version}.tgz`
const retryScript = path.resolve('scripts/ci/npm-retry-on-quarantine.sh')

function yarnFailure(url = tarball, status = '404 (Not Found)') {
  return [
    `➤ YN0035: │ @open-mercato/core@npm:${version}: Package not found`,
    `➤ YN0035: │   Response Code: ${status}`,
    '➤ YN0035: │   Request Method: GET',
    `➤ YN0035: │   Request URL: ${url}`,
  ].map((line) => `\u001b[91m${line}\u001b[39m`).join('\n')
}

function runRetry(message, { succeedOn = 2, propagationVersion = version } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-tarball-retry-'))
  const counter = path.join(directory, 'attempts')
  try {
    const command = `
      const fs = require('node:fs')
      const count = fs.existsSync(process.env.RETRY_COUNTER) ? Number(fs.readFileSync(process.env.RETRY_COUNTER, 'utf8')) + 1 : 1
      fs.writeFileSync(process.env.RETRY_COUNTER, String(count))
      if (count < Number(process.env.RETRY_SUCCEED_ON)) {
        console.error(process.env.RETRY_MESSAGE)
        process.exit(7)
      }
    `
    const result = spawnSync('bash', [retryScript, process.execPath, '-e', command], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        NPM_PROPAGATION_VERSION: propagationVersion,
        QUARANTINE_MAX_ATTEMPTS: '3',
        QUARANTINE_RETRY_SLEEP: '0',
        RETRY_COUNTER: counter,
        RETRY_MESSAGE: message,
        RETRY_SUCCEED_ON: String(succeedOn),
      },
    })
    assert.equal(result.error, undefined)
    return { ...result, attempts: Number(fs.readFileSync(counter, 'utf8')) }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('retries the observed colored snapshot tarball 404 until the actual install succeeds', () => {
  const result = runRetry(yarnFailure(), { succeedOn: 3 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.attempts, 3)
  assert.match(result.stdout, /snapshot tarball propagation detected/)
})

test('snapshot tarball propagation retries remain bounded and preserve the command exit code', () => {
  const result = runRetry(yarnFailure(), { succeedOn: 10 })
  assert.equal(result.status, 7)
  assert.equal(result.attempts, 3)
  assert.match(result.stderr, /after 3 attempts/)
})

test('a successful install runs only once', () => {
  const result = runRetry('', { succeedOn: 1 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.attempts, 1)
})

test('retries create-mercato-app tarballs at the exact snapshot version', () => {
  const result = runRetry(yarnFailure(`https://registry.npmjs.org/create-mercato-app/-/create-mercato-app-${version}.tgz`))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.attempts, 2)
})

for (const [name, message, options] of [
  ['without a published version', yarnFailure(), { propagationVersion: '' }],
  ['another version', yarnFailure(tarball.replace(version, '0.10.1-develop.1.unknown')), {}],
  ['a third-party package', yarnFailure(tarball.replace('@open-mercato/core/-/core-', 'other-package/-/other-package-')), {}],
  ['a different registry', yarnFailure(tarball.replace('registry.npmjs.org', 'example.com')), {}],
  ['an authentication error', yarnFailure(tarball, '403 (Forbidden)'), {}],
  ['a metadata 404', yarnFailure(`https://registry.npmjs.org/@open-mercato/core/${version}`), {}],
  ['a tarball with extra version suffix', yarnFailure(tarball.replace('.tgz', '.other.tgz')), {}],
  ['mixed tarball 404 and authentication errors', `${yarnFailure()}\n${yarnFailure(tarball, '403 (Forbidden)')}`, {}],
  ['an unrelated missing package alongside a snapshot 404', `${yarnFailure()}\n${yarnFailure('https://registry.npmjs.org/other/-/other-1.0.0.tgz')}`, {}],
  ['an unrelated install failure', 'YN0028: The lockfile would have been modified', {}],
  ['a client release age gate', 'YN0016: Package version is quarantined', {}],
  ['a colored client release age gate', '\u001b[91mYN0016: Package version is quarantined\u001b[39m', {}],
]) {
  test(`fails immediately for ${name}`, () => {
    const result = runRetry(message, options)
    assert.equal(result.status, 7)
    assert.equal(result.attempts, 1)
  })
}

test('continues retrying explicit registry quarantine responses', () => {
  const result = runRetry('npm error Package is quarantined pending security review')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.attempts, 2)
})

test('both snapshot consumers pass their exact published version to the retry helper', () => {
  for (const workflowName of ['snapshot', 'npm-snapshot-preview']) {
    const workflow = parse(fs.readFileSync(`.github/workflows/${workflowName}.yml`, 'utf8'))
    assert.equal(workflow.jobs['standalone-integration'].env?.NPM_PROPAGATION_VERSION,
      '${{ needs.snapshot.outputs.snapshot_version }}')
  }
})
