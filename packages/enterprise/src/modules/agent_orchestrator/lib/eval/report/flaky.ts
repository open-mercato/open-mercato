/**
 * Flaky detection across the trials of a repeated suite run (eval reports spec §a).
 *
 * - A CASE is flaky when its non-errored trials contain both a pass and a fail.
 * - An ASSERTION is flaky when its verdict differs across the trials of the same
 *   case. Skipped verdicts (`passed: null`) and errored trials carry no verdict
 *   and are ignored.
 *
 * Nothing is ever flagged when the suite ran each case once: one trial cannot
 * disagree with itself.
 */

export type FlakyTrialInput = {
  status: string
  results: ReadonlyArray<{ assertionKey: string; passed: boolean | null }>
}

export type FlakyCaseInput = {
  caseId: string
  trials: ReadonlyArray<FlakyTrialInput>
}

export type FlakyDetection = {
  flakyCaseIds: Set<string>
  flakyAssertionKeys: Set<string>
  flakyAssertionKeysByCase: Map<string, Set<string>>
}

export function isFlakyCase(trials: ReadonlyArray<{ status: string }>): boolean {
  const verdicts = trials.filter((trial) => trial.status === 'passed' || trial.status === 'failed')
  return verdicts.some((trial) => trial.status === 'passed') && verdicts.some((trial) => trial.status === 'failed')
}

export function flakyAssertionKeysForCase(trials: ReadonlyArray<FlakyTrialInput>): Set<string> {
  const verdictsByKey = new Map<string, Set<boolean>>()
  for (const trial of trials) {
    if (trial.status === 'error') continue
    for (const result of trial.results) {
      if (result.passed === null) continue
      const verdicts = verdictsByKey.get(result.assertionKey) ?? new Set<boolean>()
      verdicts.add(result.passed)
      verdictsByKey.set(result.assertionKey, verdicts)
    }
  }
  const flaky = new Set<string>()
  for (const [assertionKey, verdicts] of verdictsByKey) {
    if (verdicts.size > 1) flaky.add(assertionKey)
  }
  return flaky
}

export function detectFlaky(repeatCount: number, cases: ReadonlyArray<FlakyCaseInput>): FlakyDetection {
  const detection: FlakyDetection = {
    flakyCaseIds: new Set<string>(),
    flakyAssertionKeys: new Set<string>(),
    flakyAssertionKeysByCase: new Map<string, Set<string>>(),
  }
  if (repeatCount <= 1) return detection

  for (const entry of cases) {
    if (entry.trials.length < 2) continue
    if (isFlakyCase(entry.trials)) detection.flakyCaseIds.add(entry.caseId)
    const assertionKeys = flakyAssertionKeysForCase(entry.trials)
    if (assertionKeys.size === 0) continue
    detection.flakyAssertionKeysByCase.set(entry.caseId, assertionKeys)
    for (const assertionKey of assertionKeys) detection.flakyAssertionKeys.add(assertionKey)
  }
  return detection
}
