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

import { matchGates, shouldBlock } from '../../agentic/claude-code/hooks/gate-evidence'

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
