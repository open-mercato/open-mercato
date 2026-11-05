import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { BoardApiRow } from './kanbanBoardData'

export type SupportPortalStatus = 'received' | 'in_progress' | 'resolved'

export type SupportTicketView = {
  id: string
  supportReference: string
  categoryValue: string
  categoryLabel: string
  routedVia: 'category' | 'fallback'
  portalStatus: SupportPortalStatus
  customerName: string | null
  customerKind: string | null
  reporterName: string | null
  reportedByCustomerUserId: string | null
  unnotifiedAt: string | null
  requestSubject: string | null
  requestBody: string | null
}

export const SUPPORT_PORTAL_STATUS_VARIANT: Record<SupportPortalStatus, StatusBadgeVariant> = {
  received: 'info',
  in_progress: 'warning',
  resolved: 'success',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readPortalStatus(value: unknown): SupportPortalStatus {
  return value === 'resolved' || value === 'in_progress' ? value : 'received'
}

/** Reads the `_staffSupport.ticket` enrichment off a tasks API row. Internal tasks answer `null`. */
export function readSupportTicket(row: BoardApiRow | null | undefined): SupportTicketView | null {
  if (!row) return null
  const enrichment = (row as Record<string, unknown>)._staffSupport
  if (!isRecord(enrichment)) return null
  const ticket = enrichment.ticket
  if (!isRecord(ticket)) return null
  const id = readText(ticket, 'id')
  const supportReference = readText(ticket, 'supportReference')
  if (!id || !supportReference) return null
  const category = isRecord(ticket.category) ? ticket.category : null
  const customer = isRecord(ticket.customerSnapshot) ? ticket.customerSnapshot : null
  const request = isRecord(ticket.customerRequest) ? ticket.customerRequest : null
  return {
    id,
    supportReference,
    categoryValue: readText(category, 'value') ?? '',
    categoryLabel: readText(category, 'label') ?? readText(category, 'value') ?? '',
    routedVia: ticket.routedVia === 'category' ? 'category' : 'fallback',
    portalStatus: readPortalStatus(ticket.portalStatus),
    customerName: readText(customer, 'displayName'),
    customerKind: readText(customer, 'kind'),
    reporterName: readText(customer, 'reporterDisplayName'),
    reportedByCustomerUserId: readText(ticket, 'reportedByCustomerUserId'),
    unnotifiedAt: readText(ticket, 'unnotifiedAt'),
    requestSubject: readText(request, 'subject'),
    requestBody: typeof request?.body === 'string' ? (request.body as string) : null,
  }
}

export const SUPPORT_ACTIVITY_EVENT = 'staff.support_ticket.activity_recorded'
