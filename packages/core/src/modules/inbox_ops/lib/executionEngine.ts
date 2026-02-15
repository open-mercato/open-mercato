import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events/types'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Dictionary, DictionaryEntry } from '../../dictionaries/data/entities'
import { CustomerEntity } from '../../customers/data/entities'
import { SalesOrder, SalesShipment } from '../../sales/data/entities'
import { InboxProposal, InboxProposalAction, InboxDiscrepancy } from '../data/entities'
import type { InboxActionStatus, InboxActionType, InboxProposalStatus } from '../data/entities'
import {
  createContactPayloadSchema,
  draftReplyPayloadSchema,
  linkContactPayloadSchema,
  logActivityPayloadSchema,
  orderPayloadSchema,
  updateOrderPayloadSchema,
  updateShipmentPayloadSchema,
  type CreateContactPayload,
  type DraftReplyPayload,
  type LinkContactPayload,
  type LogActivityPayload,
  type OrderPayload,
  type UpdateOrderPayload,
  type UpdateShipmentPayload,
} from '../data/validators'
import { REQUIRED_FEATURES_MAP } from './extractionPrompt'

interface ExecutionContext {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string
  eventBus?: EventBus | null
  container: AwilixContainer
  auth?: AuthContext
}

interface ExecutionResult {
  success: boolean
  createdEntityId?: string | null
  createdEntityType?: string | null
  error?: string
  statusCode?: number
}

interface TypeExecutionResult {
  createdEntityId?: string | null
  createdEntityType?: string | null
  matchedEntityId?: string | null
  matchedEntityType?: string | null
}

class ExecutionError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

const SALES_SHIPMENT_STATUS_DICTIONARY_KEY = 'sales.shipment_status'
const ACTION_EXECUTABLE_STATUSES: InboxActionStatus[] = ['pending', 'failed']

export async function executeAction(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const em = ctx.em.fork()

  try {
    await ensureUserCanExecuteAction(action.actionType, ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to verify permissions'
    const statusCode = err instanceof ExecutionError ? err.statusCode : 503
    return { success: false, error: message, statusCode }
  }

  const claimed = await em.nativeUpdate(
    InboxProposalAction,
    {
      id: action.id,
      proposalId: action.proposalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      status: { $in: ACTION_EXECUTABLE_STATUSES },
      deletedAt: null,
    },
    {
      status: 'processing',
      executionError: null,
    },
  )

  if (claimed === 0) {
    return { success: false, error: 'Action already processed', statusCode: 409 }
  }

  const freshAction = await em.findOne(InboxProposalAction, { id: action.id, deletedAt: null })
  if (!freshAction) {
    return { success: false, error: 'Action not found', statusCode: 404 }
  }

  try {
    const result = await executeByType(freshAction, ctx)

    freshAction.status = 'executed'
    freshAction.executedAt = new Date()
    freshAction.executedByUserId = ctx.userId
    freshAction.createdEntityId = result.createdEntityId || null
    freshAction.createdEntityType = result.createdEntityType || null
    if (result.matchedEntityId !== undefined) {
      freshAction.matchedEntityId = result.matchedEntityId
    }
    if (result.matchedEntityType !== undefined) {
      freshAction.matchedEntityType = result.matchedEntityType
    }
    freshAction.executionError = null

    await em.flush()
    await resolveActionDiscrepancies(em, freshAction.id)
    await recalculateProposalStatus(em, freshAction.proposalId)

    if (ctx.eventBus) {
      await ctx.eventBus.emit('inbox_ops.action.executed', {
        actionId: freshAction.id,
        proposalId: freshAction.proposalId,
        actionType: freshAction.actionType,
        createdEntityId: result.createdEntityId || null,
        createdEntityType: result.createdEntityType || null,
        executedByUserId: ctx.userId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    }

    return { success: true, ...result, statusCode: 200 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const statusCode = err instanceof ExecutionError ? err.statusCode : 500

    freshAction.status = 'failed'
    freshAction.executionError = message
    freshAction.executedAt = new Date()
    freshAction.executedByUserId = ctx.userId
    await em.flush()

    await recalculateProposalStatus(em, freshAction.proposalId)

    if (ctx.eventBus) {
      await ctx.eventBus.emit('inbox_ops.action.failed', {
        actionId: freshAction.id,
        proposalId: freshAction.proposalId,
        actionType: freshAction.actionType,
        error: freshAction.executionError,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    }

    return { success: false, error: freshAction.executionError || 'Unknown error', statusCode }
  }
}

export async function rejectAction(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<void> {
  const em = ctx.em.fork()
  const rejectedAt = new Date()
  const claimed = await em.nativeUpdate(
    InboxProposalAction,
    {
      id: action.id,
      proposalId: action.proposalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      status: { $in: ACTION_EXECUTABLE_STATUSES },
      deletedAt: null,
    },
    {
      status: 'rejected',
      executedAt: rejectedAt,
      executedByUserId: ctx.userId,
    },
  )
  if (claimed === 0) return

  const freshAction = await em.findOne(InboxProposalAction, { id: action.id, deletedAt: null })
  if (!freshAction) return

  await resolveActionDiscrepancies(em, freshAction.id)
  await recalculateProposalStatus(em, freshAction.proposalId)

  if (ctx.eventBus) {
    await ctx.eventBus.emit('inbox_ops.action.rejected', {
      actionId: freshAction.id,
      proposalId: freshAction.proposalId,
      actionType: freshAction.actionType,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }
}

export async function rejectProposal(
  proposalId: string,
  ctx: ExecutionContext,
): Promise<void> {
  const em = ctx.em.fork()
  const actions = await em.find(InboxProposalAction, {
    proposalId,
    status: 'pending',
    deletedAt: null,
  })

  for (const action of actions) {
    action.status = 'rejected'
    action.executedAt = new Date()
    action.executedByUserId = ctx.userId
  }

  await em.flush()

  const discrepancies = await em.find(InboxDiscrepancy, {
    proposalId,
    resolved: false,
  })
  for (const discrepancy of discrepancies) {
    discrepancy.resolved = true
  }
  await em.flush()

  await recalculateProposalStatus(em, proposalId)

  if (ctx.eventBus) {
    await ctx.eventBus.emit('inbox_ops.proposal.rejected', {
      proposalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }
}

export async function acceptAllActions(
  proposalId: string,
  ctx: ExecutionContext,
): Promise<{ results: ExecutionResult[] }> {
  const em = ctx.em.fork()
  const actions = await em.find(
    InboxProposalAction,
    {
      proposalId,
      status: 'pending',
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'ASC' } },
  )

  const results: ExecutionResult[] = []

  for (const action of actions) {
    const result = await executeAction(action, ctx)
    results.push(result)
  }

  return { results }
}

async function executeByType(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  switch (action.actionType) {
    case 'create_order': {
      const parsed = orderPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid create_order payload', 400)
      }
      return executeCreateDocumentAction(action, parsed.data, ctx, 'order')
    }
    case 'create_quote': {
      const parsed = orderPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid create_quote payload', 400)
      }
      return executeCreateDocumentAction(action, parsed.data, ctx, 'quote')
    }
    case 'update_order': {
      const parsed = updateOrderPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid update_order payload', 400)
      }
      return executeUpdateOrderAction(parsed.data, ctx)
    }
    case 'update_shipment': {
      const parsed = updateShipmentPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid update_shipment payload', 400)
      }
      return executeUpdateShipmentAction(parsed.data, ctx)
    }
    case 'create_contact': {
      const parsed = createContactPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid create_contact payload', 400)
      }
      return executeCreateContactAction(parsed.data, ctx)
    }
    case 'link_contact': {
      const parsed = linkContactPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid link_contact payload', 400)
      }
      return executeLinkContactAction(parsed.data)
    }
    case 'log_activity': {
      const parsed = logActivityPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid log_activity payload', 400)
      }
      return executeLogActivityAction(parsed.data, ctx)
    }
    case 'draft_reply': {
      const parsed = draftReplyPayloadSchema.safeParse(action.payload)
      if (!parsed.success) {
        throw new ExecutionError('Invalid draft_reply payload', 400)
      }
      return executeDraftReplyAction(action, parsed.data, ctx)
    }
    default:
      throw new ExecutionError(`Unknown action type: ${action.actionType}`, 400)
  }
}

async function executeCreateDocumentAction(
  action: InboxProposalAction,
  payload: OrderPayload,
  ctx: ExecutionContext,
  kind: 'order' | 'quote',
): Promise<TypeExecutionResult> {
  const currencyCode = payload.currencyCode.trim().toUpperCase()
  const lines = payload.lineItems.map((line, index) => {
    const quantity = parseNumberToken(line.quantity, `lineItems[${index}].quantity`)
    const unitPrice = line.unitPrice
      ? parseNumberToken(line.unitPrice, `lineItems[${index}].unitPrice`)
      : undefined

    const mappedLine: Record<string, unknown> = {
      lineNumber: index + 1,
      kind: line.kind ?? (line.productId ? 'product' : 'service'),
      name: line.productName,
      description: line.description,
      quantity,
      currencyCode,
    }

    if (line.productId) mappedLine.productId = line.productId
    if (line.variantId) mappedLine.productVariantId = line.variantId
    if (unitPrice !== undefined) mappedLine.unitPriceNet = unitPrice
    if (line.sku || line.catalogPrice) {
      mappedLine.catalogSnapshot = {
        sku: line.sku ?? null,
        catalogPrice: line.catalogPrice ?? null,
      }
    }

    return mappedLine
  })

  const metadata = buildSourceMetadata(action.id, action.proposalId)
  const customerSnapshot: Record<string, unknown> = {
    displayName: payload.customerName,
  }
  if (payload.customerEmail) {
    customerSnapshot.primaryEmail = payload.customerEmail
  }

  const createInput: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    customerEntityId: payload.customerEntityId,
    customerReference: payload.customerReference,
    channelId: payload.channelId,
    currencyCode,
    taxRateId: payload.taxRateId,
    comments: payload.notes,
    metadata,
    customerSnapshot,
    lines,
  }

  const requestedDeliveryAt = parseDateToken(payload.requestedDeliveryDate ?? undefined)
  if (requestedDeliveryAt) {
    createInput.expectedDeliveryAt = requestedDeliveryAt
  }

  if (kind === 'order') {
    const result = await executeCommand<Record<string, unknown>, { orderId?: string }>(
      ctx,
      'sales.orders.create',
      createInput,
    )
    if (!result.orderId) {
      throw new ExecutionError('Order creation did not return an order ID', 500)
    }
    return {
      createdEntityId: result.orderId,
      createdEntityType: 'sales_order',
    }
  }

  const result = await executeCommand<Record<string, unknown>, { quoteId?: string }>(
    ctx,
    'sales.quotes.create',
    createInput,
  )
  if (!result.quoteId) {
    throw new ExecutionError('Quote creation did not return a quote ID', 500)
  }
  return {
    createdEntityId: result.quoteId,
    createdEntityType: 'sales_quote',
  }
}

async function executeUpdateOrderAction(
  payload: UpdateOrderPayload,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  const order = await resolveOrderByReference(
    ctx.em,
    ctx.tenantId,
    ctx.organizationId,
    payload.orderId,
    payload.orderNumber,
  )

  const updateInput: Record<string, unknown> = {
    id: order.id,
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
  }

  const newDeliveryDate = parseDateToken(payload.deliveryDateChange?.newDate)
  if (newDeliveryDate) {
    updateInput.expectedDeliveryAt = newDeliveryDate
  }

  const noteLines = payload.noteAdditions?.map((note) => note.trim()).filter((note) => note.length > 0) ?? []
  if (noteLines.length > 0) {
    const mergedNotes = [order.comments ?? null, ...noteLines].filter(Boolean).join('\n')
    updateInput.comments = mergedNotes
  }

  if (Object.keys(updateInput).length > 3) {
    await executeCommand<Record<string, unknown>, { orderId?: string }>(
      ctx,
      'sales.orders.update',
      updateInput,
    )
  }

  const quantityChanges = payload.quantityChanges ?? []
  for (const quantityChange of quantityChanges) {
    if (!quantityChange.lineItemId) {
      throw new ExecutionError('Quantity changes require lineItemId for order line updates', 400)
    }

    await executeCommand<{ body: Record<string, unknown> }, { orderId?: string; lineId?: string }>(
      ctx,
      'sales.orders.lines.upsert',
      {
        body: {
          id: quantityChange.lineItemId,
          orderId: order.id,
          organizationId: ctx.organizationId,
          tenantId: ctx.tenantId,
          quantity: parseNumberToken(quantityChange.newQuantity, 'quantityChanges.newQuantity'),
          currencyCode: order.currencyCode,
        },
      },
    )
  }

  return {
    createdEntityId: order.id,
    createdEntityType: 'sales_order',
  }
}

async function executeUpdateShipmentAction(
  payload: UpdateShipmentPayload,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  const order = await resolveOrderByReference(
    ctx.em,
    ctx.tenantId,
    ctx.organizationId,
    payload.orderId,
    payload.orderNumber,
  )

  const shipment = await findOneWithDecryption(
    ctx.em,
    SalesShipment,
    {
      order: order.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'DESC' } },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!shipment) {
    throw new ExecutionError('No shipment found for the referenced order', 404)
  }

  const statusEntryId = await resolveShipmentStatusEntryId(
    ctx.em,
    ctx.tenantId,
    ctx.organizationId,
    payload.statusLabel,
  )
  if (!statusEntryId) {
    throw new ExecutionError(`Shipment status "${payload.statusLabel}" not found`, 400)
  }

  const updateInput: Record<string, unknown> = {
    id: shipment.id,
    orderId: order.id,
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    statusEntryId,
  }

  if (payload.trackingNumbers) updateInput.trackingNumbers = payload.trackingNumbers
  if (payload.carrierName) updateInput.carrierName = payload.carrierName
  if (payload.notes) updateInput.notes = payload.notes

  const shippedAt = parseDateToken(payload.shippedAt)
  const deliveredAt = parseDateToken(payload.deliveredAt)
  if (shippedAt) updateInput.shippedAt = shippedAt
  if (deliveredAt) updateInput.deliveredAt = deliveredAt

  await executeCommand<Record<string, unknown>, { shipmentId?: string }>(
    ctx,
    'sales.shipments.update',
    updateInput,
  )

  return {
    createdEntityId: shipment.id,
    createdEntityType: 'sales_shipment',
  }
}

async function executeCreateContactAction(
  payload: CreateContactPayload,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  if (payload.type === 'company') {
    const result = await executeCommand<Record<string, unknown>, { entityId?: string }>(
      ctx,
      'customers.companies.create',
      {
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        displayName: payload.name,
        legalName: payload.companyName ?? payload.name,
        primaryEmail: payload.email,
        primaryPhone: payload.phone,
        source: payload.source,
      },
    )
    if (!result.entityId) {
      throw new ExecutionError('Company creation did not return an entity ID', 500)
    }
    return {
      createdEntityId: result.entityId,
      createdEntityType: 'customer_company',
    }
  }

  const { firstName, lastName } = splitPersonName(payload.name)
  const result = await executeCommand<Record<string, unknown>, { entityId?: string }>(
    ctx,
    'customers.people.create',
    {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      displayName: payload.name,
      firstName,
      lastName,
      primaryEmail: payload.email,
      primaryPhone: payload.phone,
      jobTitle: payload.role,
      source: payload.source,
    },
  )

  if (!result.entityId) {
    throw new ExecutionError('Person creation did not return an entity ID', 500)
  }

  return {
    createdEntityId: result.entityId,
    createdEntityType: 'customer_person',
  }
}

function executeLinkContactAction(payload: LinkContactPayload): TypeExecutionResult {
  return {
    createdEntityId: payload.contactId,
    createdEntityType: payload.contactType === 'company' ? 'customer_company' : 'customer_person',
    matchedEntityId: payload.contactId,
    matchedEntityType: payload.contactType,
  }
}

async function executeLogActivityAction(
  payload: LogActivityPayload,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  if (!payload.contactId) {
    throw new ExecutionError('log_activity requires contactId', 400)
  }

  const result = await executeCommand<Record<string, unknown>, { activityId?: string }>(
    ctx,
    'customers.activities.create',
    {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      entityId: payload.contactId,
      activityType: payload.activityType,
      subject: payload.subject,
      body: payload.body,
      authorUserId: ctx.userId,
    },
  )

  if (!result.activityId) {
    throw new ExecutionError('Activity creation did not return an activity ID', 500)
  }

  return {
    createdEntityId: result.activityId,
    createdEntityType: 'customer_activity',
  }
}

async function executeDraftReplyAction(
  action: InboxProposalAction,
  payload: DraftReplyPayload,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  const payloadRecord = action.payload as Record<string, unknown>
  const explicitContactId = typeof payloadRecord.contactId === 'string' ? payloadRecord.contactId : null
  const contactId = explicitContactId ?? (await resolveCustomerEntityIdByEmail(ctx, payload.to))

  if (!contactId) {
    return {
      createdEntityId: null,
      createdEntityType: 'inbox_ops_draft_reply',
    }
  }

  const details = [
    payload.body.trim(),
    '',
    '---',
    `Draft reply target: ${payload.to}`,
    `Subject: ${payload.subject}`,
    payload.context ? `Context: ${payload.context}` : null,
    `InboxOps Proposal: ${action.proposalId}`,
    `InboxOps Action: ${action.id}`,
  ]
    .filter((line) => typeof line === 'string' && line.length > 0)
    .join('\n')

  const result = await executeCommand<Record<string, unknown>, { activityId?: string }>(
    ctx,
    'customers.activities.create',
    {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      entityId: contactId,
      activityType: 'email',
      subject: payload.subject,
      body: details,
      authorUserId: ctx.userId,
    },
  )

  if (!result.activityId) {
    throw new ExecutionError('Draft reply activity did not return an activity ID', 500)
  }

  return {
    createdEntityId: result.activityId,
    createdEntityType: 'customer_activity',
  }
}

async function ensureUserCanExecuteAction(actionType: InboxActionType, ctx: ExecutionContext): Promise<void> {
  const requiredFeature = getRequiredFeature(actionType)
  if (!requiredFeature) return

  const rbacService = ctx.container.resolve('rbacService') as {
    userHasAllFeatures: (
      userId: string,
      features: string[],
      scope: { tenantId: string; organizationId: string },
    ) => Promise<boolean>
  }

  if (!rbacService || typeof rbacService.userHasAllFeatures !== 'function') {
    throw new ExecutionError('Unable to verify permissions for action execution', 503)
  }

  const hasFeature = await rbacService.userHasAllFeatures(
    ctx.userId,
    [requiredFeature],
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!hasFeature) {
    throw new ExecutionError(`Insufficient permissions: ${requiredFeature} required`, 403)
  }
}

async function executeCommand<TInput, TResult>(
  ctx: ExecutionContext,
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

function buildSourceMetadata(actionId: string, proposalId: string): Record<string, unknown> {
  return {
    source: 'inbox_ops',
    inboxOpsActionId: actionId,
    inboxOpsProposalId: proposalId,
  }
}

async function resolveOrderByReference(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  orderId?: string,
  orderNumber?: string,
): Promise<SalesOrder> {
  const where: Record<string, unknown> = {
    tenantId,
    organizationId,
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
    em,
    SalesOrder,
    where,
    undefined,
    { tenantId, organizationId },
  )
  if (!order) {
    throw new ExecutionError('Referenced order not found', 404)
  }
  return order
}

async function resolveShipmentStatusEntryId(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  statusLabel: string,
): Promise<string | null> {
  const dictionary = await em.findOne(Dictionary, {
    key: SALES_SHIPMENT_STATUS_DICTIONARY_KEY,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!dictionary) return null

  const entries = await em.find(DictionaryEntry, {
    dictionary: dictionary.id,
    tenantId,
    organizationId,
  })
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

async function resolveCustomerEntityIdByEmail(
  ctx: ExecutionContext,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const entity = await findOneWithDecryption(
    ctx.em,
    CustomerEntity,
    {
      primaryEmail: normalized,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  return entity?.id ?? null
}

function normalizeDictionaryToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function splitPersonName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim()
  const parts = trimmed.split(/\s+/).filter((item) => item.length > 0)
  if (parts.length <= 1) {
    return {
      firstName: parts[0] || 'Unknown',
      lastName: 'Unknown',
    }
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function parseNumberToken(value: string, fieldName: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ExecutionError(`Invalid numeric value for ${fieldName}`, 400)
  }
  return parsed
}

function parseDateToken(value?: string | null): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

async function resolveActionDiscrepancies(em: EntityManager, actionId: string): Promise<void> {
  const discrepancies = await em.find(InboxDiscrepancy, {
    actionId,
    resolved: false,
  })
  for (const discrepancy of discrepancies) {
    discrepancy.resolved = true
  }
  if (discrepancies.length > 0) {
    await em.flush()
  }
}

export async function recalculateProposalStatus(
  em: EntityManager,
  proposalId: string,
): Promise<void> {
  const proposal = await em.findOne(InboxProposal, { id: proposalId })
  if (!proposal) return

  const actions = await em.find(InboxProposalAction, {
    proposalId,
    deletedAt: null,
  })

  if (actions.length === 0) {
    proposal.status = 'pending'
    await em.flush()
    return
  }

  const statuses = actions.map((action) => action.status)
  const allAcceptedOrExecuted = statuses.every((status) => status === 'accepted' || status === 'executed')
  const allRejected = statuses.every((status) => status === 'rejected')
  const allPending = statuses.every((status) => status === 'pending')

  let newStatus: InboxProposalStatus
  if (allAcceptedOrExecuted) {
    newStatus = 'accepted'
  } else if (allRejected) {
    newStatus = 'rejected'
  } else if (allPending) {
    newStatus = 'pending'
  } else {
    newStatus = 'partial'
  }

  if (proposal.status !== newStatus) {
    proposal.status = newStatus
    await em.flush()
  }
}

export function getRequiredFeature(actionType: InboxActionType): string {
  return REQUIRED_FEATURES_MAP[actionType]
}
