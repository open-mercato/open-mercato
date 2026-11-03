/**
 * Trusted dispatch-origin markers for queue jobs.
 *
 * Jobs that drive privileged side effects (payment webhook processors and
 * similar sinks) MUST only execute payloads enqueued by trusted infrastructure
 * code paths. The scheduler dispatch layer and inbound webhook routes mark the
 * payloads they enqueue; sensitive workers verify the marker before doing work.
 *
 * The scheduler payload sanitizer strips every caller-supplied `_`-prefixed
 * key from scheduled target payloads, so a marker cannot be forged through the
 * scheduler job API. Direct queue/Redis write access is operator-level access
 * and outside this threat model.
 */

export const QUEUE_JOB_ORIGIN_KEY = '_jobOrigin'

export type QueueJobOrigin = 'inbound-webhook' | 'scheduler'

export function markQueueJobOrigin<T extends Record<string, unknown>>(
  payload: T,
  origin: QueueJobOrigin,
): T {
  return { ...payload, [QUEUE_JOB_ORIGIN_KEY]: origin }
}

export function readQueueJobOrigin(payload: unknown): QueueJobOrigin | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as Record<string, unknown>)[QUEUE_JOB_ORIGIN_KEY]
  if (value === 'inbound-webhook' || value === 'scheduler') return value
  return null
}

export function isTrustedWebhookDispatch(payload: unknown): boolean {
  return readQueueJobOrigin(payload) === 'inbound-webhook'
}
