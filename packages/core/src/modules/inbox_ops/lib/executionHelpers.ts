import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events/types'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import type { CrossModuleEntities } from './executionEngine'
export { formatZodErrors } from './validation'

// ---------------------------------------------------------------------------
// Context type used by helper functions (concrete types for ORM/DI access)
// ---------------------------------------------------------------------------

export interface ExecutionHelperContext {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string
  eventBus?: EventBus | null
  container: AwilixContainer
  auth?: AuthContext
  entities?: CrossModuleEntities
}

/**
 * Cast InboxActionExecutionContext (from shared) to the concrete helper context.
 * The inbox-actions.ts handlers receive InboxActionExecutionContext but helpers
 * need concrete EntityManager / AwilixContainer types.
 */
export function asHelperContext(ctx: InboxActionExecutionContext): ExecutionHelperContext {
  return ctx as unknown as ExecutionHelperContext
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ExecutionError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

export async function executeCommand<TInput, TResult>(
  ctx: ExecutionHelperContext,
  commandId: string,
  input: TInput,
): Promise<TResult> {
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new ExecutionError('Command bus is not available', 503)
  }

  const auth =
    ctx.auth ??
    ({
      sub: ctx.userId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      orgId: ctx.organizationId,
      isSuperAdmin: false,
    } satisfies Exclude<AuthContext, null>)

  const commandContext: CommandRuntimeContext = {
    container: ctx.container,
    auth,
    organizationScope: null,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: [ctx.organizationId],
  }

  const { result } = await commandBus.execute<TInput, TResult>(commandId, {
    input,
    ctx: commandContext,
  })

  return result
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

export function resolveEntityClass<K extends keyof CrossModuleEntities>(
  ctx: ExecutionHelperContext,
  key: K,
): CrossModuleEntities[K] | null {
  const fromEntities = ctx.entities?.[key]
  if (fromEntities) return fromEntities
  try { return ctx.container.resolve(key) } catch { return null }
}

// ---------------------------------------------------------------------------
// Source metadata
// ---------------------------------------------------------------------------

export function buildSourceMetadata(actionId: string, proposalId: string): Record<string, unknown> {
  return {
    source: 'inbox_ops',
    inboxOpsActionId: actionId,
    inboxOpsProposalId: proposalId,
  }
}

// ---------------------------------------------------------------------------
// Order resolution
// ---------------------------------------------------------------------------

export async function resolveOrderByReference(
  ctx: ExecutionHelperContext,
  orderId?: string,
  orderNumber?: string,
): Promise<{ id: string; orderNumber: string; currencyCode: string; comments?: string | null }> {
  const SalesOrderClass = resolveEntityClass(ctx, 'SalesOrder')
  if (!SalesOrderClass) {
    throw new ExecutionError('Sales module entities not available', 503)
  }

  const where: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  }
  if (orderId) {
    where.id = orderId
  } else if (orderNumber && orderNumber.trim().length > 0) {
    where.orderNumber = orderNumber.trim()
  } else {
    throw new ExecutionError('Order reference is required', 400)
  }

  const order = await findOneWithDecryption(
    ctx.em,
    SalesOrderClass,
    where,
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!order) {
    throw new ExecutionError('Referenced order not found', 404)
  }
  return order
}

// ---------------------------------------------------------------------------
// Channel resolution
// ---------------------------------------------------------------------------

export async function resolveFirstChannelId(ctx: ExecutionHelperContext): Promise<string | null> {
  const SalesChannelClass = resolveEntityClass(ctx, 'SalesChannel')
  if (!SalesChannelClass) return null

  try {
    const channel = await findOneWithDecryption(
      ctx.em,
      SalesChannelClass,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { orderBy: { name: 'ASC' } },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return channel?.id ?? null
  } catch {
    return null
  }
}

export async function resolveChannelCurrency(
  ctx: ExecutionHelperContext,
  channelId: string | null,
): Promise<string | null> {
  const SalesChannelClass = resolveEntityClass(ctx, 'SalesChannel')
  if (!SalesChannelClass) return null

  try {
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    }
    if (channelId) where.id = channelId
    const channel = await findOneWithDecryption(
      ctx.em,
      SalesChannelClass,
      where,
      channelId ? undefined : { orderBy: { name: 'ASC' } },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return channel?.currencyCode ?? null
  } catch {
    return null
  }
}

export async function resolveEffectiveDocumentKind(
  ctx: ExecutionHelperContext,
  channelId: string,
): Promise<'order' | 'quote'> {
  const SalesChannelClass = resolveEntityClass(ctx, 'SalesChannel')
  if (!SalesChannelClass) return 'order'

  const channel = await findOneWithDecryption(
    ctx.em,
    SalesChannelClass,
    {
      id: channelId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!channel) return 'order'

  const metadata = channel.metadata as Record<string, unknown> | null
  if (metadata?.quotesRequired === true) {
    return 'quote'
  }
  return 'order'
}

// ---------------------------------------------------------------------------
// Shipment status resolution
// ---------------------------------------------------------------------------

const SALES_SHIPMENT_STATUS_DICTIONARY_KEY = 'sales.shipment_status'

export async function resolveShipmentStatusEntryId(
  ctx: ExecutionHelperContext,
  statusLabel: string,
): Promise<string | null> {
  const DictionaryClass = resolveEntityClass(ctx, 'Dictionary')
  const DictionaryEntryClass = resolveEntityClass(ctx, 'DictionaryEntry')
  if (!DictionaryClass || !DictionaryEntryClass) return null

  const encryptionScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }

  const dictionary = await findOneWithDecryption(
    ctx.em,
    DictionaryClass,
    {
      key: SALES_SHIPMENT_STATUS_DICTIONARY_KEY,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    encryptionScope,
  )
  if (!dictionary) return null

  const entries = await findWithDecryption(
    ctx.em,
    DictionaryEntryClass,
    {
      dictionary: dictionary.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    },
    undefined,
    encryptionScope,
  )
  if (!entries.length) return null

  const normalizedTarget = normalizeDictionaryToken(statusLabel)
  const loweredTarget = statusLabel.trim().toLowerCase()

  const match = entries.find((entry) => {
    const label = entry.label.trim().toLowerCase()
    const value = entry.value.trim().toLowerCase()
    return (
      entry.normalizedValue === normalizedTarget ||
      label === loweredTarget ||
      value === loweredTarget
    )
  })

  return match?.id ?? null
}

// ---------------------------------------------------------------------------
// Customer / contact resolution
// ---------------------------------------------------------------------------

export async function resolveCustomerEntityIdByEmail(
  ctx: ExecutionHelperContext,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const CustomerEntityClass = resolveEntityClass(ctx, 'CustomerEntity')
  if (!CustomerEntityClass) return null

  const entity = await findOneWithDecryption(
    ctx.em,
    CustomerEntityClass,
    {
      primaryEmail: normalized,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (entity) return entity.id

  const candidates = await findWithDecryption(
    ctx.em,
    CustomerEntityClass,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    { limit: 100, orderBy: { createdAt: 'DESC' } },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  const match = candidates.find(
    (e) => e.primaryEmail && e.primaryEmail.toLowerCase() === normalized,
  )
  return match?.id ?? null
}

export async function resolveContactIdByNameAndType(
  ctx: ExecutionHelperContext,
  contactName: string,
  contactType: string,
): Promise<string | null> {
  const CustomerEntityClass = resolveEntityClass(ctx, 'CustomerEntity')
  if (!CustomerEntityClass) return null

  const normalized = contactName.trim()
  if (!normalized) return null

  const entity = await findOneWithDecryption(
    ctx.em,
    CustomerEntityClass,
    {
      displayName: normalized,
      kind: contactType,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  return entity?.id ?? null
}

// ---------------------------------------------------------------------------
// Order line items
// ---------------------------------------------------------------------------

export interface OrderLineItem {
  id: string
  name?: string | null
}

export async function loadOrderLineItems(
  ctx: ExecutionHelperContext,
  orderId: string,
): Promise<OrderLineItem[]> {
  try {
    const result = await executeCommand<Record<string, unknown>, { lines?: OrderLineItem[] }>(
      ctx,
      'sales.orders.lines.list',
      { orderId, organizationId: ctx.organizationId, tenantId: ctx.tenantId },
    )
    return result.lines ?? []
  } catch {
    return []
  }
}

export function matchLineItemByName(
  orderLines: OrderLineItem[],
  lineItemName: string,
): string | null {
  const target = lineItemName.trim().toLowerCase()
  if (!target) return null

  const exact = orderLines.find((l) => (l.name || '').trim().toLowerCase() === target)
  if (exact) return exact.id

  const partial = orderLines.find((l) => {
    const name = (l.name || '').trim().toLowerCase()
    return name.includes(target) || target.includes(name)
  })
  return partial?.id ?? null
}

// ---------------------------------------------------------------------------
// Data normalization utilities
// ---------------------------------------------------------------------------

export function normalizeAddressSnapshot(
  address: Record<string, unknown>,
): Record<string, unknown> {
  return {
    addressLine1: address.line1 ?? address.addressLine1 ?? '',
    addressLine2: address.line2 ?? address.addressLine2 ?? null,
    companyName: address.company ?? address.companyName ?? null,
    name: address.contactName ?? address.name ?? null,
    city: address.city ?? null,
    region: address.state ?? address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
  }
}

export function parseDateToken(value?: string | null): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

export function parseNumberToken(value: string, fieldName: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ExecutionError(`Invalid numeric value for ${fieldName}`, 400)
  }
  return parsed
}

export function normalizeDictionaryToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

// ---------------------------------------------------------------------------
// Product discrepancy resolution (used by catalog inbox action handler)
// ---------------------------------------------------------------------------

export async function resolveProductDiscrepanciesInProposal(
  em: EntityManager,
  proposalId: string,
  productTitle: string,
  productId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const { InboxDiscrepancy, InboxProposalAction } = await import('../data/entities')

  const discrepancies = await findWithDecryption(
    em,
    InboxDiscrepancy,
    {
      proposalId,
      type: 'product_not_found',
      resolved: false,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )

  const normalizedTitle = productTitle.toLowerCase().trim()
  const matchingDiscrepancies = discrepancies.filter((d) => {
    const foundValue = (d.foundValue || '').toLowerCase().trim()
    return foundValue === normalizedTitle
  })

  if (matchingDiscrepancies.length === 0) return

  // Phase 1: flush scalar mutations before any queries to avoid UoW tracking loss (SPEC-018)
  for (const discrepancy of matchingDiscrepancies) {
    discrepancy.resolved = true
  }
  await em.flush()

  // Phase 2: update line item product IDs (involves findOneWithDecryption queries)
  const actionIds = matchingDiscrepancies
    .map((d) => d.actionId)
    .filter((id): id is string => !!id)

  for (const actionId of actionIds) {
    const action = await findOneWithDecryption(
      em,
      InboxProposalAction,
      { id: actionId, deletedAt: null },
      undefined,
      scope,
    )
    if (!action) continue

    const payload = action.payload as Record<string, unknown>
    const lineItems = Array.isArray(payload?.lineItems)
      ? (payload.lineItems as Record<string, unknown>[])
      : []

    let updated = false
    for (const item of lineItems) {
      if (item.productId) continue
      const itemName = (typeof item.productName === 'string' ? item.productName : '').toLowerCase().trim()
      if (itemName === normalizedTitle) {
        item.productId = productId
        updated = true
        break
      }
    }

    if (updated) {
      action.payload = { ...payload, lineItems }
    }
  }

  if (actionIds.length > 0) {
    await em.flush()
  }
}
