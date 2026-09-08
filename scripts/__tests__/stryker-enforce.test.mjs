import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_BREAK_THRESHOLD,
  DEFAULT_MIN_MUTANTS,
  decideMissingReportOutcome,
  decideOutcome,
  isEnforcementEnabled,
  parseEnforceArgs,
} from '../stryker/enforce.mjs'

const ENFORCE_SCRIPT = fileURLToPath(new URL('../stryker/enforce.mjs', import.meta.url))

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
    coveredFiles: [],
    uncoveredFiles: [],
  })
  assert.deepEqual(parseEnforceArgs(['m.json', '--threshold', '85', '--min-mutants', '5']), {
    reportPath: 'm.json',
    threshold: 85,
    minMutants: 5,
    coveredFiles: [],
    uncoveredFiles: [],
  })
})

test('parses the partition file lists, dropping blanks and surrounding whitespace', () => {
  const args = parseEnforceArgs([
    'm.json',
    '--covered',
    'src/lib/a.ts, src/lib/b.ts,',
    '--uncovered',
    'src/lib/c.ts',
  ])

  assert.deepEqual(args.coveredFiles, ['src/lib/a.ts', 'src/lib/b.ts'])
  assert.deepEqual(args.uncoveredFiles, ['src/lib/c.ts'])
})

test('a mutation run skipped for lack of coverage never fails, even when enforced', () => {
  const outcome = decideMissingReportOutcome({
    coveredFiles: [],
    uncoveredFiles: ['src/lib/fresh.ts'],
    enforce: true,
  })

  assert.equal(outcome.shouldFail, false)
  assert.match(outcome.reason, /1 changed file\(s\) need tests/)
  assert.match(outcome.reason, /src\/lib\/fresh\.ts/)
})

test('a report missing after Stryker did run on covered files still fails closed', () => {
  const outcome = decideMissingReportOutcome({
    coveredFiles: ['src/lib/tested.ts'],
    uncoveredFiles: ['src/lib/fresh.ts'],
    enforce: true,
  })

  assert.equal(outcome.shouldFail, true)
  assert.match(outcome.reason, /failing closed/)
})

test('no partition information at all keeps the fail-closed rule', () => {
  const enforced = decideMissingReportOutcome({ enforce: true })
  const advisory = decideMissingReportOutcome({ enforce: false })

  assert.equal(enforced.shouldFail, true)
  assert.equal(advisory.shouldFail, false)
  assert.match(advisory.reason, /nothing to enforce \(advisory\)/)
})

test('"nothing was covered" is scored exactly like "no mutants were generated"', () => {
  const nothingCovered = decideMissingReportOutcome({
    coveredFiles: [],
    uncoveredFiles: ['src/lib/fresh.ts'],
    enforce: true,
  })
  const nothingGenerated = decideOutcome({ files: {} }, { enforce: true })

  assert.equal(nothingCovered.shouldFail, nothingGenerated.shouldFail)
})

function runEnforceCli({ args = [], env = {} } = {}) {
  return spawnSync(process.execPath, [ENFORCE_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MUTATION_ENFORCE: '', ...env },
  })
}

test('fails closed when the report is absent and enforcement is enabled', () => {
  const result = runEnforceCli({
    args: ['/nonexistent/mutation.json'],
    env: { MUTATION_ENFORCE: 'true' },
  })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /No mutation report found and enforcement is enabled/)
})

test('stays advisory when the report is absent and enforcement is disabled', () => {
  const result = runEnforceCli({ args: ['/nonexistent/mutation.json'] })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /nothing to enforce \(advisory\)/)
})

test('the CLI passes an all-uncovered skip through without failing an enforced gate', () => {
  const result = runEnforceCli({
    args: ['/nonexistent/mutation.json', '--covered', '', '--uncovered', 'src/lib/fresh.ts'],
    env: { MUTATION_ENFORCE: 'true' },
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /need tests/)
})

test('an absent report is missing evidence, not a pass — the two modes differ', () => {
  const advisory = runEnforceCli({ args: ['/nonexistent/mutation.json'] })
  const enforced = runEnforceCli({
    args: ['/nonexistent/mutation.json'],
    env: { MUTATION_ENFORCE: 'true' },
  })

  assert.notEqual(advisory.status, enforced.status)
})
