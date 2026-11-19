import { z } from 'zod'

/**
 * Per-run record of agent-produced files that were NOT stored (file plane, #12).
 * Persisted as the attributes of one idempotent `artifact.capture` system span so
 * no schema change is needed; it carries only a count and a reason, never file
 * names or content.
 */
export const ARTIFACT_CAPTURE_SPAN_NAME = 'artifact.capture'

export const ARTIFACT_CAPTURE_ATTRIBUTES = {
  failedCount: 'om.artifact_capture.failed_count',
  reason: 'om.artifact_capture.reason',
} as const

export const ARTIFACT_CAPTURE_FAILURE_REASONS = ['encryption_unavailable', 'storage_unavailable'] as const

export type ArtifactCaptureFailureReason = (typeof ARTIFACT_CAPTURE_FAILURE_REASONS)[number]

export type ArtifactCaptureFailure = { count: number; reason: ArtifactCaptureFailureReason }

const attributesSchema = z.object({
  [ARTIFACT_CAPTURE_ATTRIBUTES.failedCount]: z.number().int().positive(),
  [ARTIFACT_CAPTURE_ATTRIBUTES.reason]: z.enum(ARTIFACT_CAPTURE_FAILURE_REASONS),
})

export function artifactCaptureExternalSpanId(runId: string): string {
  return `${runId}:artifact.capture`
}

export function buildArtifactCaptureAttributes(failure: ArtifactCaptureFailure): Record<string, unknown> {
  return {
    [ARTIFACT_CAPTURE_ATTRIBUTES.failedCount]: failure.count,
    [ARTIFACT_CAPTURE_ATTRIBUTES.reason]: failure.reason,
  }
}

/** Reads the failure record off an `artifact.capture` span, or `null` when absent/malformed. */
export function readArtifactCaptureFailure(
  span: { name: string; attributes?: unknown } | null | undefined,
): ArtifactCaptureFailure | null {
  if (!span || span.name !== ARTIFACT_CAPTURE_SPAN_NAME) return null
  const parsed = attributesSchema.safeParse(span.attributes)
  if (!parsed.success) return null
  return {
    count: parsed.data[ARTIFACT_CAPTURE_ATTRIBUTES.failedCount],
    reason: parsed.data[ARTIFACT_CAPTURE_ATTRIBUTES.reason],
  }
}

/**
 * Folds per-file failure reasons into one record. Encryption wins over storage:
 * it is the actionable cause an operator must fix before any file can be stored.
 */
export function summarizeArtifactCaptureFailures(
  reasons: readonly ArtifactCaptureFailureReason[],
): ArtifactCaptureFailure | null {
  if (reasons.length === 0) return null
  const reason = reasons.includes('encryption_unavailable') ? 'encryption_unavailable' : 'storage_unavailable'
  return { count: reasons.length, reason }
}
