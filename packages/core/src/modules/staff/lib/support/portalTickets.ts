import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { StaffSupportTicket, StaffTimeTask } from '../../data/entities'

const logger = createLogger('staff').child({ component: 'lib/support/portalTickets' })

export const PORTAL_SUPPORT_TICKETS_VIEW_FEATURE = 'portal.support_tickets.view'
export const PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE = 'portal.support_tickets.manage'

type AppContainer = Awaited<ReturnType<typeof createRequestContainer>>

export type SupportPortalScope = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  container: AppContainer
  em: EntityManager
  hasFeature: (feature: string) => Promise<boolean>
}

type CustomerFeatureGuard = (auth: CustomerAuthContext, features: string[], rbac: unknown) => Promise<void>

/**
 * The portal identity is resolved through `customer_accounts` with a dynamic import,
 * exactly like the EP-50 time-reports routes, so `staff` keeps no static edge to the
 * portal module: a deployment without it answers 401 instead of failing to load.
 * A session with no `customerEntityId` is refused (403); a missing feature guard
 * fails closed (403) so a revoked grant keeps working as a revocation.
 */
export async function resolveSupportPortalScope(
  req: Request,
  requiredFeature: string,
): Promise<SupportPortalScope | Response> {
  let auth: CustomerAuthContext | null = null
  let requireFeature: CustomerFeatureGuard | null = null
  try {
    const customerAuth = await import('@open-mercato/core/modules/customer_accounts/lib/customerAuth')
    auth = await customerAuth.getCustomerAuthFromRequest(req)
    const guard: unknown = (customerAuth as { requireCustomerFeature?: unknown }).requireCustomerFeature
    requireFeature = typeof guard === 'function' ? (guard as CustomerFeatureGuard) : null
  } catch (err) {
    logger.warn('staff portal support could not resolve customer auth', { err })
    return NextResponse.json({ ok: false, error: 'staff.errors.unauthorized' }, { status: 401 })
  }
  if (!auth) return NextResponse.json({ ok: false, error: 'staff.errors.unauthorized' }, { status: 401 })
  const customerId =
    typeof auth.customerEntityId === 'string' && auth.customerEntityId.trim().length > 0
      ? auth.customerEntityId.trim()
      : null
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'staff.errors.customerAccountNotLinked' }, { status: 403 })
  }
  if (!requireFeature) {
    logger.error('staff portal support could not resolve requireCustomerFeature; refusing the request', {
      feature: requiredFeature,
    })
    return NextResponse.json({ ok: false, error: 'staff.errors.forbidden' }, { status: 403 })
  }
  const guard = requireFeature
  const container = await createRequestContainer()
  const resolvedAuth = auth
  const hasFeature = async (feature: string): Promise<boolean> => {
    try {
      await guard(resolvedAuth, [feature], container.resolve('customerRbacService'))
      return true
    } catch {
      return false
    }
  }
  try {
    await guard(auth, [requiredFeature], container.resolve('customerRbacService'))
  } catch (response) {
    if (response instanceof Response) return response
    logger.warn('staff portal support feature check failed', { err: response })
    return NextResponse.json({ ok: false, error: 'staff.errors.forbidden' }, { status: 403 })
  }
  return {
    auth,
    customerId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    container,
    em: (container.resolve('em') as EntityManager).fork(),
    hasFeature,
  }
}

/**
 * THE ownership clause for every portal support read and write. Ownership comes from
 * the task's own `customer_id` — never the project's — so tickets from many customers
 * can share one project. Callers load WITH this clause rather than loading and
 * checking afterwards, so a foreign id is never read even momentarily.
 */
export function portalOwnedTaskWhere(scope: Pick<SupportPortalScope, 'tenantId' | 'organizationId' | 'customerId'>) {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    customerId: scope.customerId,
    source: 'portal' as const,
    deletedAt: null,
  }
}

export async function loadPortalOwnedTicket(
  scope: Pick<SupportPortalScope, 'tenantId' | 'organizationId' | 'customerId' | 'em'>,
  taskId: string,
): Promise<{ task: StaffTimeTask; ticket: StaffSupportTicket } | null> {
  const task = await scope.em.findOne(StaffTimeTask, { id: taskId, ...portalOwnedTaskWhere(scope) })
  if (!task) return null
  const ticket = await findOneWithDecryption(
    scope.em,
    StaffSupportTicket,
    { taskId: task.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!ticket) return null
  return { task, ticket }
}

export async function resolveCustomerDisplay(
  scope: Pick<SupportPortalScope, 'tenantId' | 'organizationId' | 'customerId' | 'em'>,
): Promise<{ displayName: string | null; kind: string | null }> {
  try {
    const customer = await findOneWithDecryption(
      scope.em,
      CustomerEntity,
      { id: scope.customerId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    const displayName = typeof customer?.displayName === 'string' ? customer.displayName : null
    const kind = typeof customer?.kind === 'string' ? customer.kind : null
    return { displayName, kind }
  } catch {
    return { displayName: null, kind: null }
  }
}
