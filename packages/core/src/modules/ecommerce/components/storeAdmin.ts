import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { StoreListBindingSummary } from '../data/enrichers'

export const STORE_STATUSES = ['draft', 'active', 'archived'] as const

export type StoreStatus = (typeof STORE_STATUSES)[number]

export type StoreAdminRecord = {
  id: string
  organizationId?: string | null
  tenantId?: string | null
  code: string
  name: string
  slug: string
  status: StoreStatus
  defaultLocale: string
  supportedLocales: string[]
  defaultCurrencyCode: string
  isPrimary: boolean
  settings?: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
  _ecommerce?: StoreListBindingSummary
}

export type StoreListResponse = {
  items: StoreAdminRecord[]
  total: number
  totalPages: number
}

export const STORES_API_PATH = 'ecommerce/stores'
export const STORES_API_URL = `/api/${STORES_API_PATH}`
export const STORE_LIST_HREF = '/backend/config/ecommerce'
export const STORE_MANAGE_FEATURE = 'ecommerce.stores.manage'
export const STORE_VIEW_FEATURE = 'ecommerce.stores.view'
export const BRANDING_MANAGE_FEATURE = 'ecommerce.branding.manage'
export const AVAILABILITY_POLICIES_API_PATH = 'availability/policies'
export const AVAILABILITY_POLICIES_API_URL = `/api/${AVAILABILITY_POLICIES_API_PATH}`
export const AVAILABILITY_VIEW_FEATURE = 'availability.policies.view'
export const AVAILABILITY_MANAGE_FEATURE = 'availability.policies.manage'

export const STORE_STATUS_VARIANTS: Record<StoreStatus, StatusBadgeVariant> = {
  draft: 'neutral',
  active: 'success',
  archived: 'warning',
}

export function formatPrimaryDomain(summary: StoreListBindingSummary | undefined): string | null {
  const domain = summary?.primaryDomain
  if (!domain) return null
  return `${domain.hostname}${domain.pathPrefix ?? ''}`
}
