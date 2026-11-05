/**
 * The enforcement decision: given a mutation report, should this job fail?
 *
 * **Enforcement ships dormant.** `MUTATION_ENFORCE` defaults to `false`, so this
 * module's answer is advisory until the core team explicitly turns the gate on —
 * see the spec's Q1 and `AGENTS.md`'s "Ask First" rule on pipeline changes. The
 * logic is implemented and tested now so that enabling it later is a one-value
 * change rather than a code change.
 *
 * Two guards keep an enabled gate honest:
 *
 *   MUTATION_MIN_MUTANTS  Below this many scored mutants the score is reported but
 *                         never fails. Small diffs are volatile: with four mutants
 *                         a single survivor is 25 percentage points.
 *
 *   thresholds.break      The score a run must reach. It is a floor for review, not
 *                         a target to maximise — the spec explicitly rejects a
 *                         repo-wide badge or a per-package leaderboard.
 *
 * Usage:
 *   node scripts/stryker/enforce.mjs <mutation.json> [--threshold 70] [--min-mutants 20]
 *                                    [--covered a.ts,b.ts] [--uncovered c.ts]
 *
 * Exits 1 only when enforcement is enabled AND the run genuinely failed — including
 * the case where no report exists at all, since an absent report is missing evidence
 * rather than a pass. The one exception is a mutation step that was never invoked
 * because every changed file was uncovered; `--covered` / `--uncovered` tell the two
 * causes apart, exactly as `renderMissingReportMarkdown` does for the job summary.
 *
 * @see .ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md
 */

import fs from 'node:fs'
import { collectSurvivors } from './report.mjs'

export const DEFAULT_BREAK_THRESHOLD = 70
export const DEFAULT_MIN_MUTANTS = 20

export function isEnforcementEnabled(environment = process.env) {
  return environment.MUTATION_ENFORCE === 'true'
}

/**
 * @returns {{ shouldFail: boolean, reason: string, score: number|null, scored: number }}
 */
export function decideOutcome(report, options = {}) {
  const {
    threshold = DEFAULT_BREAK_THRESHOLD,
    minMutants = DEFAULT_MIN_MUTANTS,
    enforce = false,
  } = options

  const { totals, score } = collectSurvivors(report)

  if (score === null) {
    return {
      shouldFail: false,
      reason: 'No mutants were generated, so there is nothing to score.',
      score: null,
      scored: 0,
    }
  }

  const rounded = Number(score.toFixed(2))

  if (totals.scored < minMutants) {
    return {
      shouldFail: false,
      reason:
        `Only ${totals.scored} scored mutant(s), below the floor of ${minMutants}. ` +
        `Score ${rounded}% is reported but not enforced — small diffs are too volatile to gate on.`,
      score: rounded,
      scored: totals.scored,
    }
  }

  if (rounded >= threshold) {
    return {
      shouldFail: false,
      reason: `Score ${rounded}% meets the ${threshold}% threshold.`,
      score: rounded,
      scored: totals.scored,
    }
  }

  if (!enforce) {
    return {
      shouldFail: false,
      reason:
        `Score ${rounded}% is below the ${threshold}% threshold. Enforcement is disabled ` +
        '(MUTATION_ENFORCE is not "true"), so this is advisory only.',
      score: rounded,
      scored: totals.scored,
    }
  }

  return {
    shouldFail: true,
    reason:
      `Score ${rounded}% is below the ${threshold}% threshold across ${totals.scored} ` +
      'scored mutants.',
    score: rounded,
    scored: totals.scored,
  }
}

function splitFileList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export function parseEnforceArgs(argv) {
  const args = {
    reportPath: null,
    threshold: DEFAULT_BREAK_THRESHOLD,
    minMutants: DEFAULT_MIN_MUTANTS,
    coveredFiles: [],
    uncoveredFiles: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--threshold' && index + 1 < argv.length) {
      args.threshold = Number(argv[index + 1])
      index += 1
    } else if (argv[index] === '--min-mutants' && index + 1 < argv.length) {
      args.minMutants = Number(argv[index + 1])
      index += 1
    } else if (argv[index] === '--covered' && index + 1 < argv.length) {
      args.coveredFiles = splitFileList(argv[index + 1])
      index += 1
    } else if (argv[index] === '--uncovered' && index + 1 < argv.length) {
      args.uncoveredFiles = splitFileList(argv[index + 1])
      index += 1
    } else if (args.reportPath === null) {
      args.reportPath = argv[index]
    }
  }

  return args
}

/**
 * The verdict for a run that left no `mutation.json` behind.
 *
 * A missing report has two causes, and only one of them is a failure. Stryker can
 * crash or be misconfigured — missing evidence, not evidence of a pass, so with
 * enforcement on that fails closed. Or the mutation step was skipped because every
 * changed file had no related test, in which case Stryker was never asked to produce
 * a report and there is nothing to fail on: that is issue #5281's whole point, and
 * failing there would just relocate the aborted gate from Stryker to this module.
 *
 * `coveredFiles` disambiguates them, mirroring `renderMissingReportMarkdown`: empty
 * covered plus a non-empty uncovered list means the skip path. Both empty means the
 * caller passed no partition information at all, so the two causes are
 * indistinguishable and the fail-closed rule stands.
 *
 * The pass verdict here matches `decideOutcome`'s existing "no mutants were
 * generated" case: "Stryker had nothing to run" and "Stryker ran and scored nothing"
 * are the same amount of evidence.
 *
 * @returns {{ shouldFail: boolean, reason: string }}
 */
export function decideMissingReportOutcome(options = {}) {
  const { coveredFiles = [], uncoveredFiles = [], enforce = false } = options

  if (coveredFiles.length === 0 && uncoveredFiles.length > 0) {
    return {
      shouldFail: false,
      reason:
        `${uncoveredFiles.length} changed file(s) need tests, so the mutation run was ` +
        `skipped and there is nothing to score: ${uncoveredFiles.join(', ')}.`,
    }
  }

  if (enforce) {
    return {
      shouldFail: true,
      reason: 'No mutation report found and enforcement is enabled; failing closed.',
    }
  }

  return {
    shouldFail: false,
    reason: 'No mutation report found; nothing to enforce (advisory).',
  }
}

function main() {
  const args = parseEnforceArgs(process.argv.slice(2))

  if (args.reportPath === null || !fs.existsSync(args.reportPath)) {
    const outcome = decideMissingReportOutcome({
      coveredFiles: args.coveredFiles,
      uncoveredFiles: args.uncoveredFiles,
      enforce: isEnforcementEnabled(),
    })

    process.stdout.write(`[stryker:enforce] ${outcome.reason}\n`)
    if (outcome.shouldFail) process.exit(1)
    return
  }

  const report = JSON.parse(fs.readFileSync(args.reportPath, 'utf8'))
  const outcome = decideOutcome(report, {
    threshold: args.threshold,
    minMutants: args.minMutants,
    enforce: isEnforcementEnabled(),
  })

  process.stdout.write(`[stryker:enforce] ${outcome.reason}\n`)
  if (outcome.shouldFail) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
