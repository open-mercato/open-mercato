import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const WAIT_SCRIPT = path.resolve('scripts/ci/npm-wait-for-metadata.sh')
const SNAPSHOT_WORKFLOWS = [
  path.resolve('.github/workflows/snapshot.yml'),
  path.resolve('.github/workflows/npm-snapshot-preview.yml'),
]

function withStub(body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-metadata-wait-'))
  try {
    return body(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function writeNpmStub(directory, succeedFromAttempt) {
  const counterPath = path.join(directory, 'attempts')
  const stubPath = path.join(directory, 'npm')
  fs.writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `attempts=$(cat ${JSON.stringify(counterPath)} 2>/dev/null || echo 0)`,
      'attempts=$((attempts + 1))',
      `echo "$attempts" > ${JSON.stringify(counterPath)}`,
      `if [ "$attempts" -ge ${succeedFromAttempt} ]; then exit 0; fi`,
      'exit 1',
    ].join('\n'),
    { mode: 0o755 },
  )
  return () => Number(fs.readFileSync(counterPath, 'utf8').trim())
}

function runWaitScript(directory, extraEnv = {}) {
  return spawnSync('bash', [WAIT_SCRIPT, '1.2.3-snapshot.1', '@open-mercato/core'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      NPM_METADATA_RETRY_SLEEP: '0',
      ...extraEnv,
    },
  })
}

test('metadata waiting tolerates delayed npm processing', () => {
  withStub((directory) => {
    const readAttempts = writeNpmStub(directory, 3)
    const result = runWaitScript(directory, { NPM_METADATA_MAX_ATTEMPTS: '4' })

    assert.equal(result.status, 0)
    assert.equal(readAttempts(), 3)
    assert.match(result.stdout, /available after attempt 3/)
  })
})

test('metadata waiting remains bounded when npm never exposes the version', () => {
  withStub((directory) => {
    const readAttempts = writeNpmStub(directory, 10)
    const result = runWaitScript(directory, { NPM_METADATA_MAX_ATTEMPTS: '2' })

    assert.equal(result.status, 1)
    assert.equal(readAttempts(), 2)
    assert.match(result.stderr, /metadata is still unavailable after 0 seconds/)
  })
})

test('snapshot workflows share the thirty-minute metadata wait', () => {
  for (const workflowPath of SNAPSHOT_WORKFLOWS) {
    const source = fs.readFileSync(workflowPath, 'utf8')
    assert.match(source, /npm-wait-for-metadata\.sh" "\$VERSION" "\$\{PACKAGES\[@\]\}"/)
    assert.doesNotMatch(source, /for i in \$\(seq 1 30\)/)
  }

  const source = fs.readFileSync(WAIT_SCRIPT, 'utf8')
  assert.match(source, /NPM_METADATA_MAX_ATTEMPTS:-180/)
  assert.match(source, /NPM_METADATA_RETRY_SLEEP:-10/)
})
