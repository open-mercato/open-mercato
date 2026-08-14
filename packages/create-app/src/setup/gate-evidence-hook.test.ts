/**
 * Gate-evidence hook decision logic.
 *
 * Both halves matter. A blocker that misses the case it exists for is useless; one that
 * fires on an unrelated session is noise, and noise gets disabled. The gate-matching cases
 * guard the specific false negative that motivated this hook — a run that reported all of
 * its gates through a single compound command line.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isAttributableGateCommand,
  matchGates,
  nextSessionState,
  resolveExitCode,
  shouldBlock,
} from '../../agentic/claude-code/hooks/gate-evidence'

test('matchGates: matches a plain package script', () => {
  assert.deepEqual(matchGates('yarn typecheck'), ['typecheck'])
})

test('matchGates: matches every gate in a compound command', () => {
  // The shape the harness itself documents, and the shape the original failing run used to
  // report all five gates at once.
  const gates = matchGates('yarn generate && yarn typecheck && yarn lint && yarn test && yarn build')
  assert.deepEqual([...gates].sort(), ['build', 'generate', 'lint', 'test', 'typecheck'])
})

test('matchGates: matches a direct invocation that bypasses the package script', () => {
  assert.ok(matchGates('npx tsc --noEmit -p tsconfig.json').includes('typecheck'))
})

test('matchGates: matches a heap-flagged typecheck', () => {
  assert.ok(matchGates('cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit').includes('typecheck'))
})

test('matchGates: returns nothing for an unrelated command', () => {
  assert.deepEqual(matchGates('git status --short'), [])
})

const SESSION_START = 1_000

test('shouldBlock: blocks when source changed this session and no typecheck has run', () => {
  assert.equal(shouldBlock({
    newestSrcMtimeMs: 2_000,
    sessionStartedAtMs: SESSION_START,
    lastGreenTypecheckMs: null,
  }), true)
})

test('shouldBlock: blocks when source changed after the last green typecheck', () => {
  assert.equal(shouldBlock({
    newestSrcMtimeMs: 3_000,
    sessionStartedAtMs: SESSION_START,
    lastGreenTypecheckMs: 2_000,
  }), true)
})

test('shouldBlock: allows when the last green typecheck is newer than the change', () => {
  assert.equal(shouldBlock({
    newestSrcMtimeMs: 2_000,
    sessionStartedAtMs: SESSION_START,
    lastGreenTypecheckMs: 3_000,
  }), false)
})

test('shouldBlock: allows a session that changed no source, even with no typecheck record', () => {
  // The false-positive guard: a docs-only or read-only session on a fresh clone must not be
  // blocked merely because the state file has never been written.
  assert.equal(shouldBlock({
    newestSrcMtimeMs: 500,
    sessionStartedAtMs: SESSION_START,
    lastGreenTypecheckMs: null,
  }), false)
})

test('shouldBlock: allows when there is no source tree at all', () => {
  assert.equal(shouldBlock({
    newestSrcMtimeMs: null,
    sessionStartedAtMs: SESSION_START,
    lastGreenTypecheckMs: null,
  }), false)
})

test('isAttributableGateCommand: accepts a plain gate and an && chain', () => {
  // `&&` short-circuits, so a non-zero status still belongs to a gate that actually ran.
  assert.equal(isAttributableGateCommand('yarn typecheck'), true)
  assert.equal(isAttributableGateCommand('yarn generate && yarn typecheck && yarn lint'), true)
})

test('isAttributableGateCommand: rejects a piped gate', () => {
  // The failure the harness's own verification rules warn about: `tail`'s exit status, not
  // `tsc`'s. Recording it would manufacture the false green this hook exists to prevent.
  assert.equal(isAttributableGateCommand('yarn typecheck | tail -30'), false)
})

test('isAttributableGateCommand: rejects sequenced and status-swallowing commands', () => {
  assert.equal(isAttributableGateCommand('yarn typecheck; yarn lint'), false)
  assert.equal(isAttributableGateCommand('yarn typecheck || true'), false)
  assert.equal(isAttributableGateCommand('yarn typecheck\nyarn lint'), false)
})

test('resolveExitCode: reads both spellings the payload may use', () => {
  assert.equal(resolveExitCode({ tool_response: { exit_code: 1 } }), 1)
  assert.equal(resolveExitCode({ tool_response: { exitCode: 2 } }), 2)
  assert.equal(resolveExitCode({ tool_response: { exit_code: 0 } }), 0)
})

test('resolveExitCode: reports an unknown status as unknown, never as a pass', () => {
  // Zero here would record a green gate nobody observed, which is the exact substitution the
  // hook is meant to make impossible.
  assert.equal(resolveExitCode({}), null)
  assert.equal(resolveExitCode({ tool_response: {} }), null)
  assert.equal(resolveExitCode({ tool_response: { exit_code: '0' } } as never), null)
})

test('nextSessionState: starts a fresh record when the session id changes', () => {
  const previous = {
    sessionId: 'session-one',
    sessionStartedAt: '2026-08-13T09:00:00.000Z',
    gates: { typecheck: { exitCode: 0, finishedAt: '2026-08-13T09:05:00.000Z' } },
  }
  const next = nextSessionState(previous, 'session-two', '2026-08-14T09:00:00.000Z')
  assert.equal(next.sessionId, 'session-two')
  assert.equal(next.sessionStartedAt, '2026-08-14T09:00:00.000Z')
  assert.equal(next.gates, undefined)
})

test('nextSessionState: keeps the record within one session', () => {
  const previous = {
    sessionId: 'session-one',
    sessionStartedAt: '2026-08-14T09:00:00.000Z',
    gates: { typecheck: { exitCode: 0, finishedAt: '2026-08-14T09:05:00.000Z' } },
  }
  assert.equal(nextSessionState(previous, 'session-one', '2026-08-14T10:00:00.000Z'), previous)
})

test('nextSessionState: a stale start time cannot leak into a later session', () => {
  // The regression this guards: with sessionStartedAt pinned to the first session forever,
  // a docs-only session gets blocked over source somebody else edited days earlier.
  const yesterday = { sessionId: 'session-one', sessionStartedAt: '2026-08-13T09:00:00.000Z' }
  const today = nextSessionState(yesterday, 'session-two', '2026-08-14T09:00:00.000Z')
  const staleEditMs = Date.parse('2026-08-13T12:00:00.000Z')
  assert.equal(shouldBlock({
    newestSrcMtimeMs: staleEditMs,
    sessionStartedAtMs: Date.parse(today.sessionStartedAt!),
    lastGreenTypecheckMs: null,
  }), false)
})

test('nextSessionState: sets the start time once when no session id is supplied', () => {
  const first = nextSessionState({}, null, '2026-08-14T09:00:00.000Z')
  assert.equal(first.sessionStartedAt, '2026-08-14T09:00:00.000Z')
  assert.equal(nextSessionState(first, null, '2026-08-14T11:00:00.000Z'), first)
})
