export type QueueTargetPayloadInput = {
  targetPayload: unknown
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  idempotencyKey: string
}

/**
 * Single source of truth for the payload a scheduled queue target receives.
 * Both the local scheduler and the asynchronous execute-schedule worker MUST
 * build their enqueue payload here so workers see one flat contract:
 * the configured targetPayload fields on the root, with scheduler-owned
 * tenantId/organizationId/_idempotencyKey applied last so they always win
 * over conflicting targetPayload fields.
 */
export function buildQueueTargetPayload(input: QueueTargetPayloadInput): Record<string, unknown> {
  const base =
    input.targetPayload && typeof input.targetPayload === 'object' && !Array.isArray(input.targetPayload)
      ? { ...(input.targetPayload as Record<string, unknown>) }
      : {}
  return {
    ...base,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    _idempotencyKey: input.idempotencyKey,
  }
}

/**
 * One logical scheduled firing must keep one idempotency key across worker
 * retries, so downstream consumers can deduplicate. Pass a retry-stable
 * execution key: the execute-schedule job id in async mode, or the firing
 * timestamp in local mode (which runs each firing exactly once).
 */
export function buildSchedulerIdempotencyKey(scheduleId: string, executionKey: string | number): string {
  return `scheduler-${scheduleId}-${executionKey}`
}
