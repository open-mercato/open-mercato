import type * as React from 'react'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readCrmAccess, visibleCrmName, type CrmAccess } from '../crmAccess'

export const LEASES_HREF = '/backend/property_management/leases'
export const SETTINGS_HREF = '/backend/property_management/settings'
export const LEASES_MANAGE_FEATURE = 'property_management.leases.manage'
export const LEASE_RESOURCE_KIND = 'property_management.lease'

export type LeaseStatus = 'proposed' | 'pending_order' | 'active' | 'declined' | 'withdrawn' | 'expired' | 'ended'
export type CancelSettlement = 'prorate' | 'credit_full' | 'keep'

export type LeaseSummary = {
  id: string
  reference: string
  status: LeaseStatus
  buildingId: string
  buildingName: string | null
  unitId: string
  unitName: string | null
  floorName: string | null
  customerCompanyId: string
  companyName?: string | null
  primaryContactPersonId: string | null
  contactName?: string | null
  contactEmail?: string | null
  startsOn: string
  termMonths: number
  endsOn: string
  daysLeft: number
  productName: string | null
  monthlyRate: string | null
  currencyCode: string | null
  salesOrderId: string | null
  salesOrderNumber?: string | null
  openProposal: { id: string; kind: string; status: string; respondBy: string } | null
  pendingChange: { kind: string; changeId: string } | null
  billingPending: boolean
  billingAttention: boolean
  unitUnavailable: boolean
  unitUnavailableFrom: string | null
  unitUnavailableUntil: string | null
  updatedAt: string
}

export type LeaseInvoiceRow = {
  periodIndex: number
  periodStart: string
  periodEnd: string
  invoiceId: string | null
  invoiceNumber?: string | null
  creditMemoId: string | null
  creditMemoNumber?: string | null
}

export type LeaseVersionRow = {
  id: string
  versionNo: number
  event: 'activated' | 'corrected' | 'extended' | 'rescheduled'
  state: 'pending' | 'in_force' | 'reverted'
  productName: string
  monthlyRate: string
  currencyCode: string | null
  startsOn: string
  endsOn: string
  months: number
  salesOrderId: string | null
  salesOrderNumber?: string | null
  recurrence: { status: string; nextInvoiceOn: string | null; cancelEffectiveOn: string | null; invoicesAvailable: boolean } | null
  invoices?: LeaseInvoiceRow[]
  createdAt: string
}

export type LeaseProposalRow = {
  id: string
  kind: 'new' | 'extension'
  status: 'sending' | 'sent' | 'approved' | 'declined' | 'withdrawn' | 'expired'
  startsOn: string
  endsOn: string
  months: number
  monthlyRate: string
  currencyCode: string | null
  message: string | null
  respondBy: string
  salesQuoteId: string | null
  salesQuoteNumber?: string | null
  createdAt: string
}

export type LeaseOperationRow = {
  id: string
  kind: string
  status: string
  attempts: number
  lastError: { code: string | null; message: string | null; status: number | null } | null
}

export type LeaseBillingRefusal = {
  changeId: string
  kind: string
  code: string | null
  message: string | null
  at: string
  restored: { endsOn: string; startsOn: string; status: string } | null
}

export type LeaseDetail = {
  lease: LeaseSummary
  leaseEnding: boolean
  leaseEndingThresholdDays: number
  pendingChange: { kind: string; changeId: string } | null
  lastBillingRefusal: LeaseBillingRefusal | null
  versions: LeaseVersionRow[]
  proposals: LeaseProposalRow[]
  operations: LeaseOperationRow[]
  billing: { canCredit: boolean; defaultSettlement: CancelSettlement; cancelAvailable: boolean }
  salesCancelAvailable?: boolean
  salesAccess?: SalesAccess
  deleted?: boolean
  crmAccess?: CrmAccess
}

export function applyLeaseCrmAccess(lease: LeaseSummary, access: CrmAccess): LeaseSummary {
  return {
    ...lease,
    companyName: visibleCrmName(access.companies, lease.companyName),
    contactName: visibleCrmName(access.people, lease.contactName),
    contactEmail: visibleCrmName(access.people, lease.contactEmail),
  }
}

export function applyLeaseDetailCrmAccess(detail: LeaseDetail): LeaseDetail {
  const crmAccess = readCrmAccess(detail.crmAccess)
  return { ...detail, crmAccess, lease: applyLeaseCrmAccess(detail.lease, crmAccess) }
}

export type SalesAccess = { orders: boolean; quotes: boolean; invoices: boolean }

export type SalesDocumentLink =
  | { state: 'none' }
  | { state: 'hidden' }
  | { state: 'link'; href: string; label: string }

const SALES_DOCUMENT_PATHS = { orders: '/backend/sales/orders', quotes: '/backend/sales/quotes' } as const

export function canSeeSales(detail: Pick<LeaseDetail, 'salesAccess'>, group: keyof SalesAccess): boolean {
  return detail.salesAccess?.[group] === true
}

export function salesDocumentLink(
  kind: keyof typeof SALES_DOCUMENT_PATHS,
  id: string | null | undefined,
  documentNumber: string | null | undefined,
  visible: boolean,
): SalesDocumentLink {
  if (!id) return { state: 'none' }
  if (!visible || documentNumber === undefined) return { state: 'hidden' }
  return { state: 'link', href: `${SALES_DOCUMENT_PATHS[kind]}/${encodeURIComponent(id)}`, label: documentNumber ?? id }
}

const ORDER_OPERATION_KINDS = ['lease_order', 'extension_order']

function orderCutAtStart(version: LeaseVersionRow): boolean {
  const cutoff = version.recurrence?.cancelEffectiveOn ?? null
  return Boolean(cutoff && cutoff.slice(0, 10) <= version.startsOn.slice(0, 10))
}

export function hasPendingOrderOperation(detail: Pick<LeaseDetail, 'operations'>): boolean {
  return detail.operations.some((operation) => ORDER_OPERATION_KINDS.includes(operation.kind))
}

export function leaseNeedsBillingCancel(detail: Pick<LeaseDetail, 'lease' | 'versions' | 'operations'>): boolean {
  if (hasPendingOrderOperation(detail)) return true
  if (!detail.versions.length) return Boolean(detail.lease.salesOrderId)
  return detail.versions.some((version) => Boolean(version.salesOrderId) && !orderCutAtStart(version))
}

export const OPEN_PROPOSAL_STATUSES: ReadonlyArray<LeaseProposalRow['status']> = ['sending', 'sent', 'declined']

export function statusVariant(status: LeaseStatus): StatusBadgeVariant {
  if (status === 'active') return 'success'
  if (status === 'proposed') return 'info'
  if (status === 'pending_order') return 'warning'
  return 'neutral'
}

export function statusLabel(t: TranslateFn, status: string): string {
  const fallbacks: Record<string, string> = {
    proposed: 'Proposed',
    pending_order: 'Activating…',
    active: 'Active',
    declined: 'Declined',
    withdrawn: 'Withdrawn',
    expired: 'Expired',
    ended: 'Ended',
  }
  return t(`property_management.leases.status.${status}`, fallbacks[status] ?? status)
}

export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return ''
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}

export function formatMoney(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
  locale: string,
  options: Pick<Intl.NumberFormatOptions, 'signDisplay'> = {},
): string {
  if (amount === null || amount === undefined || amount === '') return ''
  const numeric = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(numeric)) return String(amount)
  if (!currency) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...options }).format(numeric)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2, ...options }).format(numeric)
  } catch {
    return `${numeric.toFixed(2)} ${currency}`
  }
}

export function formatPercent(ratio: number, locale: string, options: Pick<Intl.NumberFormatOptions, 'signDisplay'> = {}): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, ...options }).format(ratio)
  } catch {
    return `${Math.round(ratio * 1000) / 10}%`
  }
}

export function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter'
}
