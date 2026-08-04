import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADVISORY_NOTE,
  collectSurvivors,
  parseReportArgs,
  renderMarkdown,
} from '../stryker/report.mjs'

const SOURCE = [
  'export function isPositive(value) {',
  '  if (value > 0) return true',
  '  return false',
  '}',
].join('\n')

function createReport(mutants) {
  return {
    schemaVersion: '1.0',
    files: {
      'src/lib/numbers.ts': { language: 'typescript', source: SOURCE, mutants },
    },
  }
}

const KILLED_MUTANT = {
  id: '1',
  mutatorName: 'EqualityOperator',
  replacement: 'value >= 0',
  status: 'Killed',
  location: { start: { line: 2, column: 7 }, end: { line: 2, column: 16 } },
}

const SURVIVED_MUTANT = {
  id: '2',
  mutatorName: 'BooleanLiteral',
  replacement: 'false',
  status: 'Survived',
  location: { start: { line: 2, column: 25 }, end: { line: 2, column: 29 } },
}

test('lists surviving mutants and omits killed ones', () => {
  const markdown = renderMarkdown(createReport([KILLED_MUTANT, SURVIVED_MUTANT]))

  assert.match(markdown, /1 surviving mutant/)
  assert.match(markdown, /src\/lib\/numbers\.ts:2:25/)
  assert.match(markdown, /BooleanLiteral/)
  assert.ok(!markdown.includes('EqualityOperator'), 'killed mutants must not be listed')
})

test('renders the original and the replacement as a -/+ pair', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]))

  assert.match(markdown, /`- true`/)
  assert.match(markdown, /`\+ false`/)
})

test('counts NoCoverage mutants as survivors — untested code is the whole point', () => {
  const noCoverage = { ...SURVIVED_MUTANT, id: '3', status: 'NoCoverage' }
  const { survivors, totals } = collectSurvivors(createReport([KILLED_MUTANT, noCoverage]))

  assert.equal(survivors.length, 1)
  assert.equal(survivors[0].status, 'NoCoverage')
  assert.equal(totals.survived, 1)
})

test('computes the score from killed plus timed-out over scored mutants', () => {
  const timeout = { ...KILLED_MUTANT, id: '4', status: 'Timeout' }
  const { score, totals } = collectSurvivors(
    createReport([KILLED_MUTANT, timeout, SURVIVED_MUTANT]),
  )

  assert.equal(totals.scored, 3)
  assert.equal(totals.killed, 1)
  assert.equal(totals.timeout, 1)
  assert.equal(totals.survived, 1)
  assert.ok(Math.abs(score - 66.67) < 0.01)
})

test('excludes errored and ignored mutants from the score but surfaces error counts', () => {
  const compileError = { ...KILLED_MUTANT, id: '5', status: 'CompileError' }
  const ignored = { ...KILLED_MUTANT, id: '6', status: 'Ignored' }
  const { totals, score } = collectSurvivors(
    createReport([KILLED_MUTANT, compileError, ignored]),
  )

  assert.equal(totals.scored, 1)
  assert.equal(totals.errors, 1)
  assert.equal(totals.ignored, 1)
  assert.equal(score, 100)

  const markdown = renderMarkdown(createReport([KILLED_MUTANT, compileError]))
  assert.match(markdown, /1 mutant\(s\) errored/)
})

test('states plainly that an advisory run does not block the merge', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]))

  assert.ok(markdown.includes(ADVISORY_NOTE))
  assert.match(markdown, /advisory/)
  assert.match(markdown, /does not block the merge/)
})

test('omits the advisory note once enforcement is enabled', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]), { enforced: true })

  assert.ok(!markdown.includes(ADVISORY_NOTE))
})

test('reports a clean result without inventing a survivor table', () => {
  const markdown = renderMarkdown(createReport([KILLED_MUTANT]))

  assert.match(markdown, /No surviving mutants/)
  assert.ok(!markdown.includes('| Location |'))
})

test('handles an empty report without producing a synthetic score', () => {
  const markdown = renderMarkdown({ files: {} })

  assert.match(markdown, /No mutants were generated/)
  assert.equal(collectSurvivors({ files: {} }).score, null)
})

test('names the package it is reporting on', () => {
  assert.match(renderMarkdown(createReport([]), { packageName: 'shared' }), /Mutation testing — `shared`/)
})

test('surfaces capped files so a truncated run never reads as full coverage', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]), {
    droppedFiles: ['src/lib/a.ts', 'src/lib/b.ts'],
  })

  assert.match(markdown, /Not measured/)
  assert.match(markdown, /2 changed file\(s\) were not mutated/)
  assert.match(markdown, /`src\/lib\/a\.ts`/)
})

test('escapes pipes so a mutated string can never break the table', () => {
  const pipeMutant = {
    ...SURVIVED_MUTANT,
    replacement: 'a || b',
    location: { start: { line: 3, column: 3 }, end: { line: 3, column: 15 } },
  }

  const markdown = renderMarkdown(createReport([pipeMutant]))
  const tableRows = markdown.split('\n').filter((line) => line.startsWith('| `src/'))

  assert.equal(tableRows.length, 1)
  assert.match(tableRows[0], /a \\\|\\\| b/)
})

test('parses the report path, package name and enforcement flag', () => {
  assert.deepEqual(parseReportArgs(['mutation.json']), {
    reportPath: 'mutation.json',
    packageName: null,
    enforced: false,
  })
  assert.deepEqual(parseReportArgs(['mutation.json', '--package', 'shared', '--enforced']), {
    reportPath: 'mutation.json',
    packageName: 'shared',
    enforced: true,
  })
})
