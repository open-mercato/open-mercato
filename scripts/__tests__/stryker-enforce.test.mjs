import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BREAK_THRESHOLD,
  DEFAULT_MIN_MUTANTS,
  decideOutcome,
  isEnforcementEnabled,
  parseEnforceArgs,
} from '../stryker/enforce.mjs'

const LOCATION = { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } }

function createReport({ killed, survived }) {
  const mutants = []
  for (let index = 0; index < killed; index += 1) {
    mutants.push({ id: `k${index}`, mutatorName: 'X', replacement: 'y', status: 'Killed', location: LOCATION })
  }
  for (let index = 0; index < survived; index += 1) {
    mutants.push({ id: `s${index}`, mutatorName: 'X', replacement: 'y', status: 'Survived', location: LOCATION })
  }
  return { files: { 'src/lib/a.ts': { source: 'const a = 1', mutants } } }
}

test('4 mutants with 1 survivor does not fail', () => {
  const outcome = decideOutcome(createReport({ killed: 3, survived: 1 }), { enforce: true })

  assert.equal(outcome.shouldFail, false)
  assert.equal(outcome.scored, 4)
})

test('30 mutants at 60% does fail once enforcement is on', () => {
  const outcome = decideOutcome(createReport({ killed: 18, survived: 12 }), { enforce: true })

  assert.equal(outcome.shouldFail, true)
  assert.equal(outcome.score, 60)
  assert.equal(outcome.scored, 30)
  assert.match(outcome.reason, /below the 70% threshold/)
})

test('the floor — not the threshold — is what saves a tiny failing diff', () => {
  const outcome = decideOutcome(createReport({ killed: 2, survived: 2 }), { enforce: true })

  assert.equal(outcome.score, 50)
  assert.equal(outcome.shouldFail, false)
  assert.match(outcome.reason, /below the floor of 20/)
  assert.match(outcome.reason, /too volatile/)
})

test('the same 50% score does fail once the mutant count clears the floor', () => {
  const outcome = decideOutcome(createReport({ killed: 10, survived: 10 }), { enforce: true })

  assert.equal(outcome.score, 50)
  assert.equal(outcome.scored, 20)
  assert.equal(outcome.shouldFail, true)
})

test('a failing score never fails the job while enforcement is disabled', () => {
  const outcome = decideOutcome(createReport({ killed: 18, survived: 12 }), { enforce: false })

  assert.equal(outcome.shouldFail, false)
  assert.equal(outcome.score, 60)
  assert.match(outcome.reason, /Enforcement is disabled/)
  assert.match(outcome.reason, /advisory/)
})

test('enforcement is off unless MUTATION_ENFORCE is exactly "true"', () => {
  assert.equal(isEnforcementEnabled({}), false)
  assert.equal(isEnforcementEnabled({ MUTATION_ENFORCE: 'false' }), false)
  assert.equal(isEnforcementEnabled({ MUTATION_ENFORCE: '1' }), false)
  assert.equal(isEnforcementEnabled({ MUTATION_ENFORCE: 'TRUE' }), false)
  assert.equal(isEnforcementEnabled({ MUTATION_ENFORCE: 'true' }), true)
})

test('the shipped defaults are the ones the spec names', () => {
  assert.equal(DEFAULT_BREAK_THRESHOLD, 70)
  assert.equal(DEFAULT_MIN_MUTANTS, 20)
})

test('a score exactly at the threshold passes', () => {
  const outcome = decideOutcome(createReport({ killed: 21, survived: 9 }), { enforce: true })

  assert.equal(outcome.score, 70)
  assert.equal(outcome.shouldFail, false)
  assert.match(outcome.reason, /meets the 70% threshold/)
})

test('an empty report is never a failure', () => {
  const outcome = decideOutcome({ files: {} }, { enforce: true })

  assert.equal(outcome.shouldFail, false)
  assert.equal(outcome.score, null)
  assert.match(outcome.reason, /nothing to score/)
})

test('parses the threshold and floor overrides', () => {
  assert.deepEqual(parseEnforceArgs(['m.json']), {
    reportPath: 'm.json',
    threshold: DEFAULT_BREAK_THRESHOLD,
    minMutants: DEFAULT_MIN_MUTANTS,
  })
  assert.deepEqual(parseEnforceArgs(['m.json', '--threshold', '85', '--min-mutants', '5']), {
    reportPath: 'm.json',
    threshold: 85,
    minMutants: 5,
  })
})
