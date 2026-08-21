import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ADVISORY_NOTE,
  collectSurvivors,
  parseReportArgs,
  renderMarkdown,
  renderMissingReportMarkdown,
} from '../stryker/report.mjs'

const REPORT_SCRIPT = fileURLToPath(new URL('../stryker/report.mjs', import.meta.url))

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

function inlineCode(value) {
  const encoded = Array.from(value, (character) => `&#${character.codePointAt(0)};`).join('')
  return `<code>${encoded}</code>`
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
  assert.ok(markdown.includes(inlineCode('src/lib/numbers.ts:2:25')))
  assert.ok(markdown.includes(inlineCode('BooleanLiteral')))
  assert.ok(!markdown.includes('EqualityOperator'), 'killed mutants must not be listed')
})

test('renders the original and the replacement as a -/+ pair', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]))

  assert.ok(markdown.includes(`- ${inlineCode('true')}`))
  assert.ok(markdown.includes(`+ ${inlineCode('false')}`))
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
  assert.ok(renderMarkdown(createReport([]), { packageName: 'shared' }).includes(inlineCode('shared')))
})

test('surfaces capped files so a truncated run never reads as full coverage', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]), {
    droppedFiles: ['src/lib/a.ts', 'src/lib/b.ts'],
  })

  assert.match(markdown, /Not measured/)
  assert.match(markdown, /2 changed file\(s\) were not mutated/)
  assert.ok(markdown.includes(inlineCode('src/lib/a.ts')))
})

test('encodes pipes so a mutated string can never break the table', () => {
  const pipeMutant = {
    ...SURVIVED_MUTANT,
    replacement: 'a || b',
    location: { start: { line: 3, column: 3 }, end: { line: 3, column: 15 } },
  }

  const markdown = renderMarkdown(createReport([pipeMutant]))
  const tableRows = markdown.split('\n').filter((line) => line.startsWith('| <code>'))

  assert.equal(tableRows.length, 1)
  assert.ok(tableRows[0].includes(inlineCode('a || b')))
  assert.equal(tableRows[0].split('|').length - 1, 5, `table columns not intact: ${tableRows[0]}`)
})

test('encodes backslashes so an escaped pipe in the source cannot break the table', () => {
  const backslashMutant = {
    ...SURVIVED_MUTANT,
    replacement: String.raw`'a\|b'`,
    location: { start: { line: 3, column: 3 }, end: { line: 3, column: 15 } },
  }

  const markdown = renderMarkdown(createReport([backslashMutant]))
  const row = markdown.split('\n').find((line) => line.startsWith('| <code>'))

  assert.ok(row.includes(inlineCode(String.raw`'a\|b'`)))
  assert.equal(row.split('|').length - 1, 5, `table columns not intact: ${row}`)
})

test('encodes every source code point so a survivor cell cannot smuggle a live code span', () => {
  const trailingBackslashMutant = {
    ...SURVIVED_MUTANT,
    replacement: '\\`@maintainer',
    location: { start: { line: 3, column: 3 }, end: { line: 3, column: 15 } },
  }

  const markdown = renderMarkdown(createReport([trailingBackslashMutant]))
  const row = markdown.split('\n').find((line) => line.startsWith('| <code>'))

  assert.ok(row.includes(inlineCode('\\`@maintainer')))
  assert.ok(!row.includes('@maintainer'))
  assert.ok(!row.includes('`'))
})

test('parses the report path, package name and enforcement flag', () => {
  assert.deepEqual(parseReportArgs(['mutation.json']), {
    reportPath: 'mutation.json',
    packageName: null,
    enforced: false,
    uncoveredFiles: [],
    coveredFiles: [],
  })
  assert.deepEqual(parseReportArgs(['mutation.json', '--package', 'shared', '--enforced']), {
    reportPath: 'mutation.json',
    packageName: 'shared',
    enforced: true,
    uncoveredFiles: [],
    coveredFiles: [],
  })
})

test('parses comma-separated --uncovered and --covered lists, dropping blanks', () => {
  const args = parseReportArgs([
    'mutation.json',
    '--uncovered',
    'src/lib/a.ts, src/lib/b.ts,',
    '--covered',
    'src/lib/c.ts,',
  ])

  assert.deepEqual(args.uncoveredFiles, ['src/lib/a.ts', 'src/lib/b.ts'])
  assert.deepEqual(args.coveredFiles, ['src/lib/c.ts'])
})

test('surfaces uncovered files as a distinct needs-tests note, alongside surviving mutants', () => {
  const markdown = renderMarkdown(createReport([SURVIVED_MUTANT]), {
    uncoveredFiles: ['src/lib/untested.ts'],
  })

  assert.match(markdown, /Needs tests/)
  assert.match(markdown, /1 changed file\(s\) have no related test/)
  assert.ok(markdown.includes(inlineCode('src/lib/untested.ts')))
})

test('surfaces uncovered files even when no mutants were generated at all', () => {
  const markdown = renderMarkdown({ files: {} }, { uncoveredFiles: ['src/lib/untested.ts'] })

  assert.match(markdown, /No mutants were generated/)
  assert.match(markdown, /Needs tests/)
  assert.ok(markdown.includes(inlineCode('src/lib/untested.ts')))
})

test('the missing-report fallback explains a fully-uncovered package without implying a crash', () => {
  const markdown = renderMissingReportMarkdown('shared', ['src/lib/untested.ts'], [])

  assert.match(markdown, /## Mutation testing/)
  assert.match(markdown, /has no related test, so nothing was mutated/)
  assert.ok(markdown.includes(inlineCode('src/lib/untested.ts')))
  assert.ok(!markdown.includes('did not get far enough to write'))
})

test('the missing-report fallback keeps the crash explanation primary when some files were covered', () => {
  // Stryker was actually invoked on the covered file(s) and still produced no report —
  // a genuine crash, not a coverage skip — so claiming "every file has no related
  // test" here would bury the real failure the mutation step logged.
  const markdown = renderMissingReportMarkdown('shared', ['src/lib/untested.ts'], ['src/lib/boolean.ts'])

  assert.match(markdown, /did not get far enough to write/)
  assert.match(markdown, /Needs tests/)
  assert.ok(markdown.includes(inlineCode('src/lib/untested.ts')))
  assert.ok(!markdown.includes('Every changed file'))
})

test('the missing-report fallback explains itself and names the package', () => {
  const markdown = renderMissingReportMarkdown('shared')

  assert.match(markdown, /## Mutation testing/)
  assert.ok(markdown.includes(`No mutation report was produced for ${inlineCode('shared')}`))
  assert.match(markdown, /did not get far enough to write/)
})

test('the missing-report fallback works without a package name', () => {
  assert.match(renderMissingReportMarkdown(), /No mutation report was produced\./)
})

test('the missing-report path reaches the job summary, not only stdout', () => {
  const summaryPath = fs.mkdtempSync(`${os.tmpdir()}/stryker-report-`) + '/summary.md'
  const result = spawnSync(process.execPath, [REPORT_SCRIPT, '/nonexistent/mutation.json', '--package', 'shared'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
  })

  assert.equal(result.status, 0)
  assert.ok(result.stdout.includes(`No mutation report was produced for ${inlineCode('shared')}`))
  assert.match(
    fs.readFileSync(summaryPath, 'utf8'),
    new RegExp(`No mutation report was produced for ${inlineCode('shared')}`),
    'a crashed mutation run must still explain itself in the job summary',
  )
})

test('encodes backticks so a survivor cell cannot break out of its code span', () => {
  const report = {
    files: {
      'src/lib/thing.ts': {
        source: 'const label = `tagged ${name}`\n',
        mutants: [
          {
            status: 'Survived',
            mutatorName: 'StringLiteral',
            location: { start: { line: 1, column: 15 }, end: { line: 1, column: 30 } },
            replacement: '`@maintainer see `ls`',
          },
        ],
      },
    },
  }

  const markdown = renderMarkdown(report)
  const row = markdown.split('\n').find((line) => line.includes(inlineCode('src/lib/thing.ts:1:15')))

  assert.ok(row.includes(inlineCode('`@maintainer see `ls`')))
  assert.ok(!row.includes('@maintainer'))
  assert.ok(!row.includes('`'))
})
