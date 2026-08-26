import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { hasAsnReceiptActivity, isAsnCloseable } from '../../lib/asnReceiving'

export type AsnStatus = 'draft' | 'in_transit' | 'received' | 'closed'
export type ReceivingLineQcStatus = 'pending' | 'passed' | 'failed'
export type PutawayTaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

export type AsnCompleteGateLine = {
  expected_qty?: string | number | null
  received_qty?: string | number | null
  qc_status?: string | null
}

export function asnStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  switch (status) {
    case 'in_transit':
      return 'info'
    case 'received':
      return 'success'
    case 'closed':
      return 'neutral'
    case 'draft':
    default:
      return 'neutral'
  }
}

export function qcStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  switch (status) {
    case 'passed':
      return 'success'
    case 'failed':
      return 'error'
    case 'pending':
    default:
      return 'warning'
  }
}

export function putawayStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  switch (status) {
    case 'in_progress':
      return 'warning'
    case 'done':
      return 'success'
    case 'cancelled':
      return 'neutral'
    case 'open':
    default:
      return 'info'
  }
}

export function formatAgingLabel(createdAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!createdAt) return null
  const createdMs = new Date(createdAt).getTime()
  if (Number.isNaN(createdMs)) return null
  const minutes = Math.max(0, Math.floor((nowMs - createdMs) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function lineHasDiscrepancy(
  expectedQty: string | number | null | undefined,
  receivedQty: string | number | null | undefined,
): boolean {
  const expected = Number(expectedQty ?? 0)
  const received = Number(receivedQty ?? 0)
  if (!Number.isFinite(expected) || !Number.isFinite(received)) return false
  return received !== expected && received > 0
}

/**
 * UI visibility for putaway Complete (and scan putaway complete CTAs).
 * Matches what callers can actually invoke successfully:
 * - HTTP floor on complete + scan/putaway requires `wms.adjust_inventory`
 * - Command then allows manage (any task) or adjust + assignee match
 * Manage-only without adjust must not see Complete (would 403 on the route).
 */
export function canShowPutawayCompleteAction(input: {
  canManagePutaway: boolean
  canAdjustInventory: boolean
  isAssignee: boolean
}): boolean {
  if (!input.canAdjustInventory) return false
  return input.canManagePutaway || input.isAssignee
}

function toCloseableLines(lines: AsnCompleteGateLine[]) {
  return lines.map((line) => ({
    expectedQty: line.expected_qty ?? 0,
    receivedQty: line.received_qty ?? 0,
    qcStatus: line.qc_status,
  }))
}

/**
 * Complete ASN affordance aligned with `wms.asns.close` / `isAsnCloseable`:
 * - Show when manage + open ASN + any receipt activity (empty / untouched lines hide Complete)
 * - Enable default submit only when QC-passed accepted qty meets expected on every line
 * - When short / QC-fail, expose close-when-short and enable submit only after that opt-in
 *   (avoids enabling a default Complete that always 409s as invalid_receipt_state)
 * - Header-only / zero-activity ASNs stay non-closeable (isAsnCloseable requires receipt activity)
 */
export function resolveAsnCompleteGate(input: {
  canManageAsn: boolean
  asnStatus: string | null | undefined
  lines: AsnCompleteGateLine[]
  closeWhenShort: boolean
}): {
  canShowComplete: boolean
  canSubmitComplete: boolean
  showCloseWhenShort: boolean
} {
  const closeableLines = toCloseableLines(input.lines)
  const canReceiveMore = input.asnStatus === 'draft' || input.asnStatus === 'in_transit'
  const canShowComplete =
    input.canManageAsn && canReceiveMore && hasAsnReceiptActivity(closeableLines)
  if (!canShowComplete) {
    return {
      canShowComplete: false,
      canSubmitComplete: false,
      showCloseWhenShort: false,
    }
  }

  const fullyCloseable = isAsnCloseable(closeableLines, false)
  return {
    canShowComplete: true,
    canSubmitComplete: isAsnCloseable(closeableLines, input.closeWhenShort),
    showCloseWhenShort: !fullyCloseable,
  }
}
