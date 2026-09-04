import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

// Regression coverage for the `documents-multi-instance` install flake: yarn's bundled
// p-cancelable throws on a timer that fires after its promise settled, killing the whole
// install as an uncaught Node exception a second or two in. No yarn setting catches it
// (httpRetry lives inside got's retry logic, which the throw escapes) and yarn 4.18.0
// still bundles the same p-cancelable as the pinned 4.17.1, so the retry wrapper is the
// only mitigation available here. These tests pin both halves of its contract: it must
// retry the crash, and it must NOT retry anything yarn actually reported.

const RETRY_SCRIPT = path.resolve('scripts/ci/yarn-retry-on-install-crash.sh')
const CI_WORKFLOW = path.resolve('.github/workflows/ci.yml')

// The real crash, trimmed from the failing run: a raw Node stack frame into yarn's own
// bundle, unprefixed by yarn's reporter, followed by Node's fatal-error footer.
const CRASH_OUTPUT = [
  'YN0000: Yarn 4.17.1',
  'YN0000: Resolution step',
  '/home/runner/.cache/node/corepack/v1/yarn/4.17.1/yarn.js:141',
  'Error: The `onCancel` handler was attached after the promise settled.',
  '    at c (/home/runner/.cache/node/corepack/v1/yarn/4.17.1/yarn.js:141:21119)',
  '    at listOnTimeout (node:internal/timers:685:17)',
  '',
  'Node.js v24.20.0',
]

function withStub(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarn-crash-retry-'))
  try {
    return body(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Writes an executable stub that prints `lines` and exits `exitCode`. When
// `succeedFromAttempt` is set, the stub counts its invocations and succeeds from that
// attempt onwards, which is how a transient failure is modelled.
function writeStub(dir, { lines, exitCode, succeedFromAttempt }) {
  const stubPath = path.join(dir, 'stub.sh')
  const counterPath = path.join(dir, 'attempts')
  const printed = lines.map((line) => `echo ${JSON.stringify(line)}`).join('\n')
  const gate =
    succeedFromAttempt === undefined
      ? ''
      : `if [ "$attempts" -ge ${succeedFromAttempt} ]; then echo "YN0000: Done"; exit 0; fi\n`

  fs.writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `attempts=$(cat ${JSON.stringify(counterPath)} 2>/dev/null || echo 0)`,
      'attempts=$((attempts + 1))',
      `echo "$attempts" > ${JSON.stringify(counterPath)}`,
      gate + printed,
      `exit ${exitCode}`,
    ].join('\n'),
    { mode: 0o755 }
  )

  return { stubPath, readAttempts: () => Number(fs.readFileSync(counterPath, 'utf8').trim()) }
}

function runRetryScript(stubPath) {
  return spawnSync('bash', [RETRY_SCRIPT, stubPath], {
    encoding: 'utf8',
    // Keep the suite fast: the wrapper's backoff is only there to space out real retries.
    env: { ...process.env, YARN_CRASH_RETRY_SLEEP: '0' },
  })
}

test('the install wrapper retries a yarn-internal crash and succeeds on the rerun', () => {
  withStub((dir) => {
    const { stubPath, readAttempts } = writeStub(dir, {
      lines: CRASH_OUTPUT,
      exitCode: 1,
      succeedFromAttempt: 2,
    })

    const result = runRetryScript(stubPath)

    assert.equal(
      result.status,
      0,
      'a crash inside yarn is transient — the wrapper must rerun it rather than failing a required job'
    )
    assert.equal(readAttempts(), 2, 'the wrapper must rerun the command exactly once after the crash')
  })
})

test('the install wrapper gives up after the configured attempts when the crash repeats', () => {
  withStub((dir) => {
    const { stubPath, readAttempts } = writeStub(dir, { lines: CRASH_OUTPUT, exitCode: 1 })

    const result = spawnSync('bash', [RETRY_SCRIPT, stubPath], {
      encoding: 'utf8',
      env: { ...process.env, YARN_CRASH_RETRY_SLEEP: '0', YARN_CRASH_MAX_ATTEMPTS: '3' },
    })

    assert.equal(result.status, 1, 'a crash that never clears must still fail the job')
    assert.equal(readAttempts(), 3, 'the wrapper must stop at YARN_CRASH_MAX_ATTEMPTS rather than looping forever')
  })
})

test('the install wrapper does not retry an --immutable lockfile violation', () => {
  withStub((dir) => {
    const { stubPath, readAttempts } = writeStub(dir, {
      lines: ['➤ YN0028: The lockfile would have been modified by this install, which is explicitly forbidden.'],
      exitCode: 78,
    })

    const result = runRetryScript(stubPath)

    assert.equal(result.status, 78, "a real install failure must fail fast and keep yarn's exit code")
    assert.equal(readAttempts(), 1, 'a reported error is deterministic — retrying it only slows the job down')
  })
})

test('the install wrapper does not retry a YN0001 exception that yarn itself reported', () => {
  withStub((dir) => {
    // Yarn prefixes every line it prints — including the stack of a YN0001 exception —
    // with the diagnostic code. That prefix is what separates a reported error from a
    // crash, so a stack frame into yarn.js must not be enough to trigger a retry.
    const { stubPath, readAttempts } = writeStub(dir, {
      lines: [
        '➤ YN0001: Error: Command failed with exit code 1',
        'YN0001:     at ChildProcess.<anonymous> (/home/runner/.cache/node/corepack/v1/yarn/4.17.1/yarn.js:390:1234)',
      ],
      exitCode: 1,
    })

    const result = runRetryScript(stubPath)

    assert.equal(result.status, 1, 'a yarn-reported exception must fail fast')
    assert.equal(
      readAttempts(),
      1,
      'the crash signal is an UNPREFIXED stack frame; a YN0001-prefixed one is a reported error'
    )
  })
})

test('the install wrapper refuses to run without a command', () => {
  const result = spawnSync('bash', [RETRY_SCRIPT], { encoding: 'utf8' })

  assert.equal(result.status, 2, 'an empty invocation is a wiring mistake and must not be reported as a passing install')
})

test('every ci.yml install step routes through the crash-retry wrapper', () => {
  const workflow = parse(fs.readFileSync(CI_WORKFLOW, 'utf8'))
  const installSteps = Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) =>
    (job?.steps ?? [])
      .filter((step) => typeof step?.run === 'string' && /\byarn install\b/.test(step.run))
      .map((step) => ({ jobName, run: step.run }))
  )

  assert.ok(
    installSteps.length > 0,
    'expected ci.yml to install dependencies — if the install moved, this guard must move with it'
  )

  for (const { jobName, run } of installSteps) {
    assert.match(
      run,
      /yarn-retry-on-install-crash\.sh/,
      `job "${jobName}" installs dependencies without the crash-retry wrapper, so a yarn-internal crash would fail it outright (see issue #5889)`
    )
  }
})
