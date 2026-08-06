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
 *
 * Exits 1 only when enforcement is enabled AND the run genuinely failed — including
 * the case where no report exists at all, since an absent report is missing evidence
 * rather than a pass.
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

export function parseEnforceArgs(argv) {
  const args = {
    reportPath: null,
    threshold: DEFAULT_BREAK_THRESHOLD,
    minMutants: DEFAULT_MIN_MUTANTS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--threshold' && index + 1 < argv.length) {
      args.threshold = Number(argv[index + 1])
      index += 1
    } else if (argv[index] === '--min-mutants' && index + 1 < argv.length) {
      args.minMutants = Number(argv[index + 1])
      index += 1
    } else if (args.reportPath === null) {
      args.reportPath = argv[index]
    }
  }

  return args
}

function main() {
  const args = parseEnforceArgs(process.argv.slice(2))

  // A missing report means the run produced no evidence, which is not the same as
  // evidence of a pass. While enforcement is off that distinction does not matter and
  // this stays advisory; with enforcement on, the module that owns the pass/fail
  // decision must not answer "no data ⇒ pass" — an absent report is the shape a
  // crashed or misconfigured mutation step takes, so it fails closed.
  if (args.reportPath === null || !fs.existsSync(args.reportPath)) {
    if (isEnforcementEnabled()) {
      process.stdout.write(
        '[stryker:enforce] No mutation report found and enforcement is enabled; failing closed.\n',
      )
      process.exit(1)
    }

    process.stdout.write(
      '[stryker:enforce] No mutation report found; nothing to enforce (advisory).\n',
    )
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
