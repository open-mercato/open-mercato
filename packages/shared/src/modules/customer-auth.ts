/**
 * Customer Auth Types — Shared Type Definitions
 *
 * Re-exports customer authentication types for use by portal UI hooks
 * and app modules that build customer-facing pages.
 *
 * The actual auth guard implementation lives in
 * `@open-mercato/core/modules/customer_accounts/lib/customerAuth`
 * — this module only provides the type contract.
 */

export interface CustomerAuthContext {
  sub: string
  type: 'customer'
  tenantId: string
  orgId: string
  email: string
  displayName: string
  customerEntityId?: string | null
  personEntityId?: string | null
  resolvedFeatures: string[]
}

export type CustomerUser = {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  customerEntityId: string | null
  personEntityId: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type CustomerRole = {
  id: string
  name: string
  slug: string
}

export type CustomerAuthResult = {
  user: CustomerUser | null
  roles: CustomerRole[]
  resolvedFeatures: string[]
  isPortalAdmin: boolean
  loading: boolean
  error: string | null
}
