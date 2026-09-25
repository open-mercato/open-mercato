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

// Writes an executable stub that replays `lines` verbatim and exits `exitCode`. When
// `succeedFromAttempt` is set, the stub counts its invocations and succeeds from that
// attempt onwards, which is how a transient failure is modelled.
//
// The fixture is written to a sidecar file and replayed with `cat` rather than built
// into a series of `echo` statements: the real crash output contains backticks (around
// `onCancel`), which bash would expand as command substitution inside a double-quoted
// echo, silently dropping the very text the fixture exists to reproduce.
function writeStub(dir, { lines, exitCode, succeedFromAttempt }) {
  const stubPath = path.join(dir, 'stub.sh')
  const counterPath = path.join(dir, 'attempts')
  const outputPath = path.join(dir, 'output.txt')
  const gate =
    succeedFromAttempt === undefined
      ? ''
      : `if [ "$attempts" -ge ${succeedFromAttempt} ]; then echo "YN0000: Done"; exit 0; fi\n`

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`)
  fs.writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `attempts=$(cat ${JSON.stringify(counterPath)} 2>/dev/null || echo 0)`,
      'attempts=$((attempts + 1))',
      `echo "$attempts" > ${JSON.stringify(counterPath)}`,
      `${gate}cat ${JSON.stringify(outputPath)}`,
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
    env: { ...process.env, INSTALL_CRASH_RETRY_SLEEP: '0' },
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

    // Guards the fixture itself: the crash message contains backticks, so a stub built
    // from `echo "..."` would have had bash expand them away and this suite would have
    // been asserting against output the real failure never produced.
    assert.match(
      result.stdout,
      /Error: The `onCancel` handler was attached after the promise settled\./,
      'the stub must replay the reported crash verbatim, backticks included'
    )
  })
})

test('the install wrapper gives up after the configured attempts when the crash repeats', () => {
  withStub((dir) => {
    const { stubPath, readAttempts } = writeStub(dir, { lines: CRASH_OUTPUT, exitCode: 1 })

    const result = spawnSync('bash', [RETRY_SCRIPT, stubPath], {
      encoding: 'utf8',
      env: { ...process.env, INSTALL_CRASH_RETRY_SLEEP: '0', INSTALL_CRASH_MAX_ATTEMPTS: '3' },
    })

    assert.equal(result.status, 1, 'a crash that never clears must still fail the job')
    assert.equal(readAttempts(), 3, 'the wrapper must stop at INSTALL_CRASH_MAX_ATTEMPTS rather than looping forever')
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

test('the install wrapper does not retry when yarn already reported a failure before crashing', () => {
  withStub((dir) => {
    // Real Yarn 4.17.1 output (reproduced against an unreachable tarball dependency
    // through `corepack yarn install`): a reported YN0001 connection failure that
    // *also* trips the same onCancel/p-cancelable race afterwards. Yarn does not
    // prefix continuation lines with the diagnostic code — only the first line of
    // a reported error carries it — so the crash pattern alone cannot tell this
    // apart from a bare internal crash. The `YN0000: ... Failed with errors`
    // marker, printed once yarn has finished reporting, is what does.
    const { stubPath, readAttempts } = writeStub(dir, {
      lines: [
        '➤ YN0001: │ Error [ERR_SOCKET_CLOSED_BEFORE_CONNECTION]: Socket closed before the connection was established',
        '    at TLSSocket.onClose (node:net:1243:10)',
        '    at TLSSocket.emit (node:events:519:28)',
        '➤ YN0000: · Failed with errors in 0s 80ms',
        '/home/runner/.cache/node/corepack/v1/yarn/4.17.1/yarn.js:141',
        'Error: The `onCancel` handler was attached after the promise settled.',
        '    at c (/home/runner/.cache/node/corepack/v1/yarn/4.17.1/yarn.js:141:21119)',
        '    at listOnTimeout (node:internal/timers:685:17)',
        '',
        'Node.js v24.20.0',
      ],
      exitCode: 1,
    })

    const result = runRetryScript(stubPath)

    assert.equal(result.status, 1, 'a yarn-reported failure must fail fast even though it also crashes afterwards')
    assert.equal(
      readAttempts(),
      1,
      'the `Failed with errors` marker means yarn already reported the real cause; retrying would only reproduce it'
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
