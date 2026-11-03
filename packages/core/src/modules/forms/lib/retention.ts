/**
 * W5 (DP-6 / DP-11) — retention eligibility decision.
 *
 * Pure, I/O-free function so the purge worker and unit tests share one
 * source of truth. The decision answers: given a submission's age and the
 * form's retention window, should the submission be purged (anonymized) now?
 *
 * Rules:
 *  - `retentionDays == null` ⇒ keep forever ⇒ never eligible.
 *  - `retentionDays <= 0` ⇒ invalid / disabled ⇒ never eligible (treated as
 *    "keep forever" so a misconfiguration cannot mass-erase data).
 *  - Already-anonymized submissions are never eligible (idempotency — the
 *    purge has nothing left to do).
 *  - Age is measured from `submittedAt` for terminal submissions, falling
 *    back to `updatedAt` for drafts / reopened submissions that never reached
 *    a submit. The cutoff is `now - retentionDays`; a submission is eligible
 *    once its reference timestamp is strictly older than the cutoff.
 *
 * Consent / signature submissions are NOT special-cased here: the same window
 * applies. Anonymization preserves the immutable version-pinned signed record
 * (only `x-om-sensitive` answers are tombstoned), which satisfies the legal
 * retention story without retaining patient PII beyond the window.
 */

export type RetentionSubmissionFacts = {
  /** When the submission was finalised. `null` for drafts / reopened. */
  submittedAt: Date | null
  /** Last write timestamp — the fallback age anchor for non-submitted rows. */
  updatedAt: Date
  /** Already-anonymized submissions are never re-eligible. */
  anonymizedAt: Date | null
}

export type RetentionDecisionInput = {
  submission: RetentionSubmissionFacts
  /** Form retention window in days; `null`/`<=0` ⇒ keep forever. */
  retentionDays: number | null | undefined
  /** Evaluation clock. */
  now: Date
}

export type RetentionDecision = {
  eligible: boolean
  /** Stable reason code — handy for structured (PII-free) logs and tests. */
  reason:
    | 'no_retention_policy'
    | 'already_anonymized'
    | 'within_window'
    | 'expired'
  /** The age-anchor timestamp the decision used. */
  referenceAt: Date
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function decideRetention(input: RetentionDecisionInput): RetentionDecision {
  const { submission, retentionDays, now } = input
  const referenceAt = submission.submittedAt ?? submission.updatedAt

  if (retentionDays == null || !Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { eligible: false, reason: 'no_retention_policy', referenceAt }
  }

  if (submission.anonymizedAt) {
    return { eligible: false, reason: 'already_anonymized', referenceAt }
  }

  const cutoff = now.getTime() - retentionDays * MS_PER_DAY
  if (referenceAt.getTime() < cutoff) {
    return { eligible: true, reason: 'expired', referenceAt }
  }
  return { eligible: false, reason: 'within_window', referenceAt }
}
