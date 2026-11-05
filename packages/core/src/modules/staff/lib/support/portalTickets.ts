import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { StaffSupportTicket, StaffTimeTask } from '../../data/entities'
import { PORTAL_SUPPORT_NOT_LINKED_CODE } from '../support-ui/portalSupport'

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
    return NextResponse.json(
      { ok: false, error: 'staff.errors.customerAccountNotLinked', code: PORTAL_SUPPORT_NOT_LINKED_CODE },
      { status: 403 },
    )
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

type PortalTicketActivityDb = {
  staff_time_tasks: {
    id: string
    tenant_id: string
    organization_id: string
    customer_id: string | null
    source: string
    task_status_id: string
    created_at: Date
    deleted_at: Date | null
  }
  staff_time_task_comments: {
    task_id: string
    tenant_id: string
    organization_id: string
    visibility: string
    created_at: Date
    deleted_at: Date | null
  }
}

export type PortalTicketPageRow = { id: string; lastActivityAt: Date }

function toDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return fallback
}

/**
 * One page of the caller's tickets, newest customer-visible activity first. Activity
 * is the latest of the ticket's filing time and its newest customer-visible comment
 * (either side), so internal staff edits — which bump `updated_at` — never reorder the
 * customer's list while a reply the customer can read always does. The ownership
 * clause is the same as `portalOwnedTaskWhere`; the activity is computed per row by a
 * correlated `max()` served by the comments `(organization_id, task_id, created_at)` index.
 */
export async function listPortalTicketPage(
  scope: Pick<SupportPortalScope, 'tenantId' | 'organizationId' | 'customerId' | 'em'>,
  options: { statusIds: readonly string[] | null; limit: number; offset: number },
): Promise<{ rows: PortalTicketPageRow[]; total: number }> {
  if (options.statusIds && options.statusIds.length === 0) return { rows: [], total: 0 }
  const db = scope.em.getKysely<PortalTicketActivityDb>()
  let owned = db
    .selectFrom('staff_time_tasks as task')
    .where('task.tenant_id', '=', scope.tenantId)
    .where('task.organization_id', '=', scope.organizationId)
    .where('task.customer_id', '=', scope.customerId)
    .where('task.source', '=', 'portal')
    .where('task.deleted_at', 'is', null)
  if (options.statusIds) owned = owned.where('task.task_status_id', 'in', [...options.statusIds])
  const lastActivity = sql<Date>`greatest(task.created_at, coalesce((
    select max(visible_comment.created_at)
    from staff_time_task_comments as visible_comment
    where visible_comment.organization_id = task.organization_id
      and visible_comment.task_id = task.id
      and visible_comment.tenant_id = task.tenant_id
      and visible_comment.visibility = 'customer'
      and visible_comment.deleted_at is null
  ), task.created_at))`
  const [countRow, pageRows] = await Promise.all([
    owned.select((builder) => builder.fn.countAll<string | number>().as('total')).executeTakeFirst(),
    owned
      .select(['task.id as id', 'task.created_at as created_at'])
      .select(lastActivity.as('last_activity_at'))
      .orderBy('last_activity_at', 'desc')
      .orderBy('task.id', 'desc')
      .limit(options.limit)
      .offset(options.offset)
      .execute(),
  ])
  const total = Number(countRow?.total ?? 0)
  return {
    total: Number.isFinite(total) ? total : 0,
    rows: pageRows.map((row) => ({
      id: row.id,
      lastActivityAt: toDate(row.last_activity_at, toDate(row.created_at, new Date(0))),
    })),
  }
}
