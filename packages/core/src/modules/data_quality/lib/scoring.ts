export interface ScoreInput {
  checks: Array<{ id: string; weight: number; enabled: boolean }>
  findings: Array<{ checkId: string; status: string }>
  totalRecords: number
}

/**
 * Calculate a weighted data quality score (0-100).
 * Score = 100 - (weighted failure rate * 100)
 *
 * Each check contributes to the score based on its weight.
 * Only "open" findings count against the score.
 */
export function calculateScore(input: ScoreInput): number {
  const { checks, findings, totalRecords } = input

  if (totalRecords === 0 || checks.length === 0) return 100

  const enabledChecks = checks.filter((check) => check.enabled)
  if (enabledChecks.length === 0) return 100

  const totalWeight = enabledChecks.reduce((sum, check) => sum + check.weight, 0)
  if (totalWeight === 0) return 100

  const openFindings = findings.filter((finding) => finding.status === 'open')

  let weightedFailureSum = 0
  for (const check of enabledChecks) {
    const checkFindings = openFindings.filter((finding) => finding.checkId === check.id)
    const failureRate = Math.min(checkFindings.length / totalRecords, 1)
    weightedFailureSum += failureRate * (check.weight / totalWeight)
  }

  const score = Math.max(0, Math.min(100, (1 - weightedFailureSum) * 100))
  return Math.round(score * 100) / 100
}

/**
 * Calculate score for a single scan run based on scanned/failed counts.
 */
export function calculateScanScore(scannedCount: number, failedCount: number): number {
  if (scannedCount === 0) return 100
  const passRate = (scannedCount - failedCount) / scannedCount
  return Math.round(passRate * 10000) / 100
}
