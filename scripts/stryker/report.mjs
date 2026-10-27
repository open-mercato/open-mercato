/**
 * mutation.json → a markdown survivor report for the GitHub Actions job summary.
 *
 * Survivors are the only actionable output: a mutant that lived is a behaviour the
 * test suite does not pin down. Killed mutants are noise in a review context and are
 * deliberately omitted — the score line already accounts for them.
 *
 * The report goes to `$GITHUB_STEP_SUMMARY` rather than a PR comment because
 * `pull_request` runs from forks receive no `pull-requests: write` token, and this
 * repository receives fork PRs. The summary needs no token and works identically for
 * everyone.
 *
 * Usage:
 *   node scripts/stryker/report.mjs <mutation.json> [--package <name>] [--enforced]
 *
 * Always exits 0 — reporting never fails a build.
 *
 * @see .ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md
 */

import fs from 'node:fs'

export const SURVIVING_STATUSES = Object.freeze(['Survived', 'NoCoverage'])
export const SCORED_STATUSES = Object.freeze(['Killed', 'Survived', 'NoCoverage', 'Timeout'])

export const ADVISORY_NOTE =
  'This check is **advisory** — it reports on the behaviour your tests do not pin down, ' +
  'and it does not block the merge.'

/**
 * Code-point ordering, not `localeCompare`: the survivor table must render in the same
 * order on every runner, and a locale-sensitive collation would make it environment
 * dependent. Kept local rather than imported from scope.mjs so this reporting module
 * stays independent of the git-diff module.
 */
function compareByCodePoint(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sliceOriginal(source, location) {
  if (typeof source !== 'string' || location?.start === undefined) return ''

  const lines = source.split('\n')
  const { start, end } = location
  if (start.line < 1 || start.line > lines.length) return ''

  if (end === undefined || end.line === start.line) {
    return lines[start.line - 1].slice(start.column - 1, end?.column ? end.column - 1 : undefined)
  }

  const first = lines[start.line - 1].slice(start.column - 1)
  const middle = lines.slice(start.line, end.line - 1)
  const last = (lines[end.line - 1] ?? '').slice(0, end.column - 1)
  return [first, ...middle, last].join('\n')
}

function toInlineCode(text) {
  const singleLine = String(text ?? '').match(/\S+/gu)?.join(' ') ?? ''
  const encoded = Array.from(singleLine, (character) => `&#${character.codePointAt(0)};`).join('')
  return `<code>${encoded}</code>`
}

/**
 * @returns {{ survivors: Array<object>, totals: { scored: number, killed: number, survived: number, timeout: number, errors: number, ignored: number }, score: number|null }}
 */
export function collectSurvivors(report) {
  const files = report?.files ?? {}
  const survivors = []
  const totals = { scored: 0, killed: 0, survived: 0, timeout: 0, errors: 0, ignored: 0 }

  for (const filePath of Object.keys(files).sort(compareByCodePoint)) {
    const file = files[filePath]
    for (const mutant of file?.mutants ?? []) {
      if (mutant.status === 'Ignored') {
        totals.ignored += 1
        continue
      }
      if (mutant.status === 'CompileError' || mutant.status === 'RuntimeError') {
        totals.errors += 1
        continue
      }

      if (SCORED_STATUSES.includes(mutant.status)) totals.scored += 1
      if (mutant.status === 'Killed') totals.killed += 1
      if (mutant.status === 'Timeout') totals.timeout += 1

      if (!SURVIVING_STATUSES.includes(mutant.status)) continue

      totals.survived += 1
      survivors.push({
        file: filePath,
        line: mutant.location?.start?.line ?? 0,
        column: mutant.location?.start?.column ?? 0,
        mutator: mutant.mutatorName ?? 'Unknown',
        status: mutant.status,
        original: sliceOriginal(file?.source, mutant.location),
        replacement: mutant.replacement ?? '',
      })
    }
  }

  const killedLike = totals.killed + totals.timeout
  const score = totals.scored === 0 ? null : (killedLike / totals.scored) * 100

  return { survivors, totals, score }
}

function renderUncoveredNote(uncoveredFiles) {
  return (
    `**Needs tests:** ${uncoveredFiles.length} changed file(s) have no related test and were not ` +
    `mutated: ${uncoveredFiles.map((file) => toInlineCode(file)).join(', ')}.`
  )
}

export function renderMarkdown(report, options = {}) {
  const { packageName = null, enforced = false, droppedFiles = [], uncoveredFiles = [] } = options
  const { survivors, totals, score } = collectSurvivors(report)
  const heading = packageName === null ? '## Mutation testing' : `## Mutation testing — ${toInlineCode(packageName)}`
  const lines = [heading, '']

  if (score === null) {
    lines.push('No mutants were generated for the changed files, so there is no score to report.')
    lines.push('')
    if (uncoveredFiles.length > 0) {
      lines.push(renderUncoveredNote(uncoveredFiles))
      lines.push('')
    }
    if (!enforced) lines.push(ADVISORY_NOTE)
    return `${lines.join('\n').trimEnd()}\n`
  }

  lines.push(
    `**Score: ${score.toFixed(2)}%** — ${totals.killed} killed, ${totals.survived} survived, ` +
      `${totals.timeout} timed out, of ${totals.scored} scored mutants.`,
  )
  lines.push('')

  if (totals.errors > 0) {
    lines.push(
      `${totals.errors} mutant(s) errored and are excluded from the score. A large number here ` +
        'usually means a systematic problem rather than a test gap.',
    )
    lines.push('')
  }

  if (survivors.length === 0) {
    lines.push('No surviving mutants. Every mutation of the changed code was caught by a test.')
  } else {
    lines.push(`### ${survivors.length} surviving mutant(s)`)
    lines.push('')
    lines.push('| Location | Mutator | Original | Replacement |')
    lines.push('| --- | --- | --- | --- |')
    for (const survivor of survivors) {
      lines.push(
        `| ${toInlineCode(`${survivor.file}:${survivor.line}:${survivor.column}`)} | ` +
          `${toInlineCode(survivor.mutator)} | - ${toInlineCode(survivor.original)} | ` +
          `+ ${toInlineCode(survivor.replacement)} |`,
      )
    }
    lines.push('')
    lines.push(
      'A surviving mutant is a question, not a verdict: it is a genuine coverage gap, an ' +
        'equivalent mutant that no test could kill, or two source paths masking each other. ' +
        'Suppress equivalent mutants at the source with `// Stryker disable next-line <mutator>` ' +
        'plus a one-line justification.',
    )
  }

  if (droppedFiles.length > 0) {
    lines.push('')
    lines.push(
      `**Not measured:** the file cap was reached, so ${droppedFiles.length} changed file(s) ` +
        `were not mutated: ${droppedFiles.map((file) => toInlineCode(file)).join(', ')}.`,
    )
  }

  if (uncoveredFiles.length > 0) {
    lines.push('')
    lines.push(renderUncoveredNote(uncoveredFiles))
  }

  if (!enforced) {
    lines.push('')
    lines.push(ADVISORY_NOTE)
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function splitFileList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export function parseReportArgs(argv) {
  const args = { reportPath: null, packageName: null, enforced: false, uncoveredFiles: [], coveredFiles: [] }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--package' && index + 1 < argv.length) {
      args.packageName = argv[index + 1]
      index += 1
    } else if (argv[index] === '--enforced') {
      args.enforced = true
    } else if (argv[index] === '--uncovered' && index + 1 < argv.length) {
      args.uncoveredFiles = splitFileList(argv[index + 1])
      index += 1
    } else if (argv[index] === '--covered' && index + 1 < argv.length) {
      args.coveredFiles = splitFileList(argv[index + 1])
      index += 1
    } else if (args.reportPath === null) {
      args.reportPath = argv[index]
    }
  }

  return args
}

/**
 * The report the summary shows when Stryker died before writing mutation.json, or
 * never ran because every changed file had no related test to run. The reporting
 * step runs `if: always()` precisely so both cases still explain themselves, so this
 * path must reach the job summary like any other — a run that leaves the summary
 * blank buries its only explanation in the step log.
 *
 * `coveredFiles` disambiguates the two causes: empty means Stryker was never
 * invoked (every file was uncovered), so the "needs tests" note replaces the
 * failure message entirely. Non-empty means Stryker *was* invoked on those files
 * and still produced no report — a genuine crash — so the failure message stays
 * primary and the uncovered note (if any) is only a supplementary aside; claiming
 * "every changed file has no related test" there would bury the real crash.
 */
export function renderMissingReportMarkdown(packageName = null, uncoveredFiles = [], coveredFiles = []) {
  const suffix = packageName === null ? '' : ` for ${toInlineCode(packageName)}`

  if (uncoveredFiles.length > 0 && coveredFiles.length === 0) {
    return (
      `## Mutation testing\n\nEvery changed file${suffix} has no related test, so nothing was ` +
      `mutated. ${renderUncoveredNote(uncoveredFiles)}\n`
    )
  }

  const uncoveredAside = uncoveredFiles.length > 0 ? ` ${renderUncoveredNote(uncoveredFiles)}` : ''
  return (
    `## Mutation testing\n\nNo mutation report was produced${suffix}. ` +
    'The mutation run did not get far enough to write `mutation.json` — check the ' +
    `mutation step above for the failure.${uncoveredAside}\n`
  )
}

function emit(markdown) {
  process.stdout.write(markdown)

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  }
}

function main() {
  const args = parseReportArgs(process.argv.slice(2))

  if (args.reportPath === null || !fs.existsSync(args.reportPath)) {
    emit(renderMissingReportMarkdown(args.packageName, args.uncoveredFiles, args.coveredFiles))
    return
  }

  const report = JSON.parse(fs.readFileSync(args.reportPath, 'utf8'))
  emit(
    renderMarkdown(report, {
      packageName: args.packageName,
      enforced: args.enforced,
      uncoveredFiles: args.uncoveredFiles,
    }),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
