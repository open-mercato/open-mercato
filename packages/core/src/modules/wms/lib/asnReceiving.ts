import { createHash } from 'crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { AsnStatus, ReceivingLineQcStatus } from '../data/entities'

const ASN_STATUSES: ReadonlySet<AsnStatus> = new Set([
  'draft',
  'in_transit',
  'received',
  'closed',
])

/**
 * Parse ASN list `status` query: single value or comma-separated
 * (e.g. `draft,in_transit` for the open receiving queue).
 * Returns `$eq` / `$in` filter fragment, or undefined when empty/invalid.
 */
export function buildAsnStatusFilter(
  statusQuery: string | undefined,
): { $eq: AsnStatus } | { $in: AsnStatus[] } | undefined {
  if (typeof statusQuery !== 'string' || statusQuery.trim().length === 0) return undefined
  const statuses = [
    ...new Set(
      statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is AsnStatus => ASN_STATUSES.has(value as AsnStatus)),
    ),
  ]
  if (statuses.length === 0) return undefined
  if (statuses.length === 1) return { $eq: statuses[0]! }
  return { $in: statuses }
}

export function assertAsnQcTransition(
  current: ReceivingLineQcStatus,
  next: 'passed' | 'failed',
): void {
  if (current === 'pending') return
  if (current === next) return
  throw new CrudHttpError(422, { error: 'invalid_qc_transition' })
}

export function shouldWriteStockOnQcPass(qcStatus: 'passed' | 'failed'): boolean {
  return qcStatus === 'passed'
}

/**
 * Accepted qty for close checks: only QC-passed quantity counts toward
 * fulfillment. QC-failed receipts increment receivedQty for audit but do not
 * satisfy the ASN unless `closeWhenShort` is set.
 */
export function acceptedReceivedQty(line: {
  receivedQty: string | number
  qcStatus?: ReceivingLineQcStatus | string | null
}): number {
  const received = Number(line.receivedQty)
  if (!Number.isFinite(received) || received <= 0) return 0
  if (line.qcStatus !== 'passed') return 0
  return received
}

/** True when at least one receiving line has recorded receipt qty (> 0). */
export function hasAsnReceiptActivity(
  lines: Array<{ receivedQty: string | number }>,
): boolean {
  return lines.some((line) => {
    const received = Number(line.receivedQty)
    return Number.isFinite(received) && received > 0
  })
}

/**
 * Aligns with `wms.receiving-lines.delete`: any received qty or non-pending QC
 * blocks soft-deleting the ASN (would free `source_key` while staging stock remains).
 */
export function hasAsnDeleteBlockingLineActivity(
  lines: Array<{ receivedQty: string | number; qcStatus?: string | null }>,
): boolean {
  return lines.some((line) => {
    const received = Number(line.receivedQty)
    if (Number.isFinite(received) && received > 0) return true
    return line.qcStatus !== 'pending'
  })
}

export function isAsnCloseable(
  lines: Array<{
    expectedQty: string | number
    receivedQty: string | number
    qcStatus?: ReceivingLineQcStatus | string | null
  }>,
  closeWhenShort: boolean,
): boolean {
  // Header-only ASNs (no receiving lines) are never closeable — `[].every` would
  // otherwise be vacuously true and `closeWhenShort` would short-circuit to true.
  if (lines.length === 0) return false
  // Zero-activity lines (all receivedQty 0) must not close even with closeWhenShort —
  // that flag only covers short / QC-fail receipts after some receipt activity.
  if (!hasAsnReceiptActivity(lines)) return false
  if (closeWhenShort) return true
  return lines.every((line) => {
    const expected = Number(line.expectedQty)
    if (!Number.isFinite(expected)) return false
    return acceptedReceivedQty(line) + 0.000001 >= expected
  })
}

export function buildStableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Resolve the stable receive attempt identity.
 *
 * Both QC-pass and QC-fail MUST supply absolute `targetReceivedQty` (enforced by
 * zod + command). Optional `idempotencyKey` is an extra stabilizer, but the
 * attempt key always includes absolute target — same key + different target must
 * not reuse the first movement/putaway identity while advancing line qty.
 * Never derive target as `prior + receivedQty` (that path double-applies audit
 * qty on identical HTTP retry after success).
 */
export function resolveAsnReceiveAttempt(input: {
  lineId: string
  priorReceivedQty: number
  receivedQty: number
  targetReceivedQty?: number | null
  idempotencyKey?: string | null
}): {
  attemptKey: string
  targetReceivedQty: number
  applyQty: number
} {
  const idempotencyKey = input.idempotencyKey?.trim() || null
  const hasAbsoluteTarget =
    input.targetReceivedQty != null && Number.isFinite(input.targetReceivedQty)
  if (!hasAbsoluteTarget) {
    throw new CrudHttpError(422, { error: 'target_received_qty_required' })
  }
  const targetReceivedQty = Number(input.targetReceivedQty)
  const applyQty = Math.max(0, targetReceivedQty - input.priorReceivedQty)
  // Always include absolute target so same idempotencyKey + higher target cannot
  // reuse the first movement referenceId / putaway_key while applyQty > 0.
  const attemptKey = idempotencyKey
    ? ['wms:asn-receive-idemp', input.lineId, idempotencyKey, String(targetReceivedQty)].join(':')
    : ['wms:asn-receive-target', input.lineId, String(targetReceivedQty)].join(':')
  return { attemptKey, targetReceivedQty, applyQty }
}

/** Deterministic movement referenceId so client retries reuse inventory idempotency. */
export function buildAsnReceiveReferenceId(input: {
  attemptKey: string
  serialNumber?: string | null
}): string {
  return buildStableUuid(
    ['wms:asn-receive', input.attemptKey, input.serialNumber?.trim() ?? ''].join(':'),
  )
}

export function buildAsnReceivePutawayKey(input: { attemptKey: string }): string {
  return buildStableUuid(['wms:asn-receive-putaway', input.attemptKey].join(':'))
}

export function putawayMetadataMatchesKey(
  metadata: Record<string, unknown> | null | undefined,
  putawayKey: string,
): boolean {
  if (!metadata) return false
  return metadata.putawayKey === putawayKey
}

/**
 * QC-pass retries with applyQty=0 must still ensure a queue task when the
 * auto-created putaway was cancelled (cancel clears putaway_key). Reuse any
 * open/in_progress/done task; otherwise find-or-create again.
 */
export function shouldEnsurePutawayOnAlreadyAtTarget(
  existingOpenPutaway: { id: string } | null | undefined,
): boolean {
  return existingOpenPutaway == null
}

/**
 * Prefer the cancelled task's quantity (metadata still carries putawayKey after
 * column clear); fall back to absolute target for first-shot receives.
 */
export function resolvePutawayQuantityForAlreadyAtTargetRetry(input: {
  cancelledTaskQuantity: number | null | undefined
  absoluteTargetQty: number
}): number {
  const fromCancelled =
    input.cancelledTaskQuantity != null && Number.isFinite(input.cancelledTaskQuantity)
      ? Number(input.cancelledTaskQuantity)
      : null
  if (fromCancelled != null && fromCancelled > 0.000001) return fromCancelled
  return Math.max(0, input.absoluteTargetQty)
}

/**
 * Idempotent already-at-target recreate must not open a second putaway when
 * staging stock is already fully committed by other open/in_progress tasks
 * (manual putaway after cancel). Skip create when remaining would go negative.
 */
export function shouldRecreatePutawayOnAlreadyAtTarget(input: {
  requestedQuantity: number
  remainingAvailable: number
}): boolean {
  if (!(input.requestedQuantity > 0.000001)) return false
  return input.requestedQuantity <= input.remainingAvailable + 0.000001
}

/** Reject lifecycle fields on receiving-line CRUD before zod strips them. */
export function assertReceivingLineLifecycleFieldsForbidden(rawInput: unknown): void {
  if (!rawInput || typeof rawInput !== 'object') return
  const payload = rawInput as Record<string, unknown>
  if ('qcStatus' in payload || 'receivedQty' in payload || 'rejectionReason' in payload) {
    throw new CrudHttpError(422, { error: 'lifecycle_field_forbidden' })
  }
}
