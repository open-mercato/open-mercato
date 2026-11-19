import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type PortalSupportStatus = 'received' | 'in_progress' | 'resolved'

export type PortalSupportTicketListItem = {
  id: string
  supportReference: string
  subject: string
  category: { value: string; label: string }
  portalStatus: PortalSupportStatus
  createdAt: string | null
  updatedAt: string | null
  lastActivityAt: string | null
}

export type PortalSupportTicketList = {
  items?: PortalSupportTicketListItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export type PortalSupportOptions = {
  categories?: Array<{ value: string; label: string }>
  canCreate?: boolean
  maxUploadBytes?: number | null
}

export type PortalSupportMessage = {
  id: string
  authorKind: 'staff' | 'customer'
  authorName: string | null
  isSelf?: boolean
  body: string
  createdAt: string | null
}

export type PortalSupportTicketDetail = {
  id: string
  supportReference: string
  subject: string
  description: string
  category: { value: string; label: string }
  portalStatus: PortalSupportStatus
  createdAt: string | null
  updatedAt: string | null
  canReply: boolean
  requester?: { name: string | null; isSelf: boolean }
  messages: PortalSupportMessage[]
  attachments?: PortalSupportAttachment[]
}

export type PortalSupportAttachment = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string | null
  downloadUrl: string
  uploadedByCustomer: boolean
  canDelete: boolean
  createdAt: string | null
}

export const PORTAL_SUPPORT_UPDATED_EVENT = 'staff.support_ticket.portal_updated'

export const PORTAL_SUPPORT_NOT_LINKED_CODE = 'customer_account_not_linked'

/**
 * A portal account without a company link can never see or file tickets, so the
 * support screens explain that instead of offering a retry that cannot succeed.
 */
export function isPortalSupportAccountNotLinked(call: { status: number; result?: unknown }): boolean {
  if (call.status !== 403 || !call.result || typeof call.result !== 'object') return false
  return (call.result as { code?: unknown }).code === PORTAL_SUPPORT_NOT_LINKED_CODE
}

export const PORTAL_SUPPORT_STATUS_VARIANTS: Record<PortalSupportStatus, StatusBadgeVariant> = {
  received: 'info',
  in_progress: 'warning',
  resolved: 'success',
}

export function portalSupportStatusLabel(t: TranslateFn, status: PortalSupportStatus): string {
  if (status === 'resolved') return t('staff.portal.support.status.resolved', 'Resolved')
  if (status === 'in_progress') return t('staff.portal.support.status.inProgress', 'In progress')
  return t('staff.portal.support.status.received', 'Received')
}

export function formatPortalDate(value: string | null | undefined, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatFileSize(t: TranslateFn, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return t('staff.portal.support.fileSize.bytes', '{size} B', { size: 0 })
  if (bytes < 1024) return t('staff.portal.support.fileSize.bytes', '{size} B', { size: bytes })
  if (bytes < 1024 * 1024) {
    return t('staff.portal.support.fileSize.kilobytes', '{size} KB', { size: (bytes / 1024).toFixed(1) })
  }
  return t('staff.portal.support.fileSize.megabytes', '{size} MB', { size: (bytes / (1024 * 1024)).toFixed(1) })
}

export function failedUploadsStorageKey(ticketId: string): string {
  return `om:staff:support:failed-uploads:${ticketId}`
}

export function readPortalTicketIdFromEvent(event: { payload?: Record<string, unknown> } | null | undefined): string | null {
  const payload = event?.payload
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload.ticketId ?? payload.id
  return typeof candidate === 'string' ? candidate : null
}
