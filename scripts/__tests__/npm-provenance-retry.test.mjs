import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const RETRY_SCRIPT = path.resolve('scripts/ci/npm-retry-on-provenance-conflict.sh')
const PUBLISH_SCRIPT = path.resolve('scripts/publish-packages.sh')
const TLOG_CONFLICT = [
  'npm error code TLOG_CREATE_ENTRY_ERROR',
  'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log',
]

function withStub(body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-provenance-retry-'))
  try {
    return body(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function writeStub(directory, { lines, exitCode, succeedFromAttempt }) {
  const stubPath = path.join(directory, 'stub.sh')
  const counterPath = path.join(directory, 'attempts')
  const outputPath = path.join(directory, 'output.txt')
  const successGate =
    succeedFromAttempt === undefined
      ? ''
      : `if [ "$attempts" -ge ${succeedFromAttempt} ]; then echo "published"; exit 0; fi\n`

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`)
  fs.writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `attempts=$(cat ${JSON.stringify(counterPath)} 2>/dev/null || echo 0)`,
      'attempts=$((attempts + 1))',
      `echo "$attempts" > ${JSON.stringify(counterPath)}`,
      `${successGate}cat ${JSON.stringify(outputPath)}`,
      `exit ${exitCode}`,
    ].join('\n'),
    { mode: 0o755 }
  )

  return {
    stubPath,
    readAttempts: () => Number(fs.readFileSync(counterPath, 'utf8').trim()),
  }
}

function runRetryScript(stubPath, extraEnv = {}) {
  return spawnSync('bash', [RETRY_SCRIPT, stubPath], {
    encoding: 'utf8',
    env: { ...process.env, NPM_PROVENANCE_RETRY_SLEEP: '0', ...extraEnv },
  })
}

test('the wrapper retries a Rekor duplicate-entry conflict and preserves provenance', () => {
  withStub((directory) => {
    const { stubPath, readAttempts } = writeStub(directory, {
      lines: TLOG_CONFLICT,
      exitCode: 1,
      succeedFromAttempt: 2,
    })

    const result = runRetryScript(stubPath)

    assert.equal(result.status, 0)
    assert.equal(readAttempts(), 2)
    assert.match(result.stdout, /retry-after-success Rekor conflict/)
  })
})

test('the wrapper stops after the configured number of repeated conflicts', () => {
  withStub((directory) => {
    const { stubPath, readAttempts } = writeStub(directory, {
      lines: TLOG_CONFLICT,
      exitCode: 1,
    })

    const result = runRetryScript(stubPath, { NPM_PROVENANCE_MAX_ATTEMPTS: '2' })

    assert.equal(result.status, 1)
    assert.equal(readAttempts(), 2)
    assert.match(result.stderr, /duplicate-entry conflict 2 times/)
  })
})

test('the wrapper does not retry a real npm publish failure', () => {
  withStub((directory) => {
    const { stubPath, readAttempts } = writeStub(directory, {
      lines: ['npm error code E403', 'npm error forbidden package publication'],
      exitCode: 1,
    })

    const result = runRetryScript(stubPath)

    assert.equal(result.status, 1)
    assert.equal(readAttempts(), 1)
    assert.match(result.stderr, /non-retryable error/)
  })
})

test('the publish script routes provenance publishing through the narrow retry wrapper', () => {
  const source = fs.readFileSync(PUBLISH_SCRIPT, 'utf8')

  assert.match(
    source,
    /npm-retry-on-provenance-conflict\.sh" \\\n+\s+npm publish "package\.tgz" --access public --tag "\$TAG" --provenance/
  )
  assert.match(source, /npm view "\$PKG_NAME@\$PKG_VERSION" version/)
})
