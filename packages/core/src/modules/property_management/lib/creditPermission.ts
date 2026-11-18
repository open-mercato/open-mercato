import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { hasGrantedFeature } from './featureAccess'
import type { Scope } from './productUse'

export const CREDIT_MEMO_FEATURE = 'sales.credit_memos.manage'
export const SALES_ORDERS_VIEW_FEATURE = 'sales.orders.view'
export const SALES_QUOTES_VIEW_FEATURE = 'sales.quotes.view'
export const SALES_INVOICES_FEATURE = 'sales.invoices.manage'

export type SalesAccess = { orders: boolean; quotes: boolean; invoices: boolean }

export async function hasSalesFeature(container: AwilixContainer, auth: AuthContext | null, scope: Scope, feature: string): Promise<boolean> {
  return hasGrantedFeature(container, auth, scope, feature, 'property_management.credit_permission_check_failed')
}

export async function hasCreditPermission(container: AwilixContainer, auth: AuthContext | null, scope: Scope): Promise<boolean> {
  return hasSalesFeature(container, auth, scope, CREDIT_MEMO_FEATURE)
}

export async function resolveSalesAccess(container: AwilixContainer, auth: AuthContext | null, scope: Scope): Promise<SalesAccess> {
  const [orders, quotes, invoices] = await Promise.all([
    hasSalesFeature(container, auth, scope, SALES_ORDERS_VIEW_FEATURE),
    hasSalesFeature(container, auth, scope, SALES_QUOTES_VIEW_FEATURE),
    hasSalesFeature(container, auth, scope, SALES_INVOICES_FEATURE),
  ])
  return { orders, quotes, invoices }
}
