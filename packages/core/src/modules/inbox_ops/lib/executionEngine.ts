import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events/types'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposal, InboxProposalAction, InboxDiscrepancy } from '../data/entities'
import type { InboxActionStatus, InboxActionType, InboxProposalStatus } from '../data/entities'
import {
  createContactPayloadSchema,
  createProductPayloadSchema,
  draftReplyPayloadSchema,
  linkContactPayloadSchema,
  logActivityPayloadSchema,
  orderPayloadSchema,
  updateOrderPayloadSchema,
  updateShipmentPayloadSchema,
  type CreateContactPayload,
  type CreateProductPayload,
  type DraftReplyPayload,
  type LinkContactPayload,
  type LogActivityPayload,
  type OrderPayload,
  type UpdateOrderPayload,
  type UpdateShipmentPayload,
} from '../data/validators'
import { REQUIRED_FEATURES_MAP } from './constants'
import { formatZodErrors } from './validation'

interface CommonEntityFields {
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
  createdAt?: Date
}

export interface CrossModuleEntities {
  CustomerEntity: EntityClass<CommonEntityFields & { id: string; kind: string; displayName: string; primaryEmail?: string | null }>
  SalesOrder: EntityClass<CommonEntityFields & { id: string; orderNumber: string; currencyCode: string; comments?: string | null; customerReference?: string | null }>
  SalesShipment: EntityClass<CommonEntityFields & { id: string; order: unknown }>
  SalesChannel: EntityClass<CommonEntityFields & { id: string; name: string; currencyCode?: string; metadata?: Record<string, unknown> | null }>
  Dictionary: EntityClass<CommonEntityFields & { id: string; key: string }>
  DictionaryEntry: EntityClass<CommonEntityFields & { id: string; label: string; value: string; normalizedValue?: string | null; dictionary: unknown }>
}

interface ExecutionContext {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string
  eventBus?: EventBus | null
  container: AwilixContainer
  auth?: AuthContext
  entities?: CrossModuleEntities
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
    await ensureUserCanExecuteAction(action, ctx)
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

  const freshAction = await findOneWithDecryption(
    em,
    InboxProposalAction,
    { id: action.id, deletedAt: null },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
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
    const encScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await resolveActionDiscrepancies(em, freshAction.id, encScope)

    // After create_contact or link_contact, resolve unknown_contact discrepancies
    // on ALL other actions in the same proposal that reference the same email
    if (freshAction.actionType === 'create_contact' || freshAction.actionType === 'link_contact') {
      const payload = freshAction.payload as Record<string, unknown> | null
      const contactEmail =
        typeof payload?.email === 'string' ? payload.email
          : typeof payload?.emailAddress === 'string' ? payload.emailAddress
            : null
      if (contactEmail) {
        await resolveUnknownContactDiscrepanciesInProposal(
          em, freshAction.proposalId, contactEmail, encScope,
        )
      }
    }

    await recalculateProposalStatus(em, freshAction.proposalId, encScope)

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

    await recalculateProposalStatus(em, freshAction.proposalId, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })

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

  const freshAction = await findOneWithDecryption(
    em,
    InboxProposalAction,
    { id: action.id, deletedAt: null },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!freshAction) return

  const encScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  await resolveActionDiscrepancies(em, freshAction.id, encScope)
  await recalculateProposalStatus(em, freshAction.proposalId, encScope)

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
  const rejectedAt = new Date()

  await em.nativeUpdate(
    InboxProposalAction,
    {
      proposalId,
      status: { $in: ACTION_EXECUTABLE_STATUSES },
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    {
      status: 'rejected',
      executedAt: rejectedAt,
      executedByUserId: ctx.userId,
    },
  )

  await em.nativeUpdate(
    InboxDiscrepancy,
    {
      proposalId,
      resolved: false,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    },
    { resolved: true },
  )

  await recalculateProposalStatus(em, proposalId, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })

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
): Promise<{ results: ExecutionResult[]; stoppedOnFailure: boolean }> {
  const em = ctx.em.fork()
  const actions = await findWithDecryption(
    em,
    InboxProposalAction,
    {
      proposalId,
      status: 'pending',
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'ASC' } },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  const results: ExecutionResult[] = []
  let stoppedOnFailure = false

  for (const action of actions) {
    const result = await executeAction(action, ctx)
    results.push(result)

    if (!result.success) {
      stoppedOnFailure = true
      break
    }
  }

  return { results, stoppedOnFailure }
}

/**
 * Normalize LLM-generated payloads before validation.
 * Fixes common issues: case-sensitive enums, missing fields that can be resolved,
 * and alternate field names the LLM might use.
 */
async function normalizePayload(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<Record<string, unknown>> {
  const payload = { ...(action.payload as Record<string, unknown>) }

  // Lowercase contact type fields (LLM often outputs "Person" / "Company")
  if (typeof payload.type === 'string') {
    payload.type = payload.type.toLowerCase()
  }
  if (typeof payload.contactType === 'string') {
    payload.contactType = payload.contactType.toLowerCase()
  }

  // Normalize link_contact field names (LLM may use various alternatives for
  // emailAddress/contactId/contactType/contactName — e.g. from the pre-matched contacts format)
  if (action.actionType === 'link_contact') {
    if (!payload.emailAddress) {
      const alt = payload.email ?? payload.contactEmail
      if (typeof alt === 'string') payload.emailAddress = alt
    }
    if (!payload.contactId) {
      const alt = payload.id ?? payload.matchedId ?? payload.matchedContactId
      if (typeof alt === 'string') payload.contactId = alt
    }
    if (!payload.contactType) {
      const alt = payload.type ?? payload.kind ?? payload.matchedType ?? payload.matchedContactType
      if (typeof alt === 'string') payload.contactType = alt.toLowerCase()
    }
    if (!payload.contactName) {
      const alt = payload.name ?? payload.displayName
      if (typeof alt === 'string') payload.contactName = alt
    }
  }

  // Resolve missing currencyCode for order/quote payloads from channel
  if (action.actionType === 'create_order' || action.actionType === 'create_quote') {
    if (!payload.currencyCode) {
      const channelId = typeof payload.channelId === 'string' ? payload.channelId : null
      const resolved = await resolveChannelCurrency(ctx, channelId)
      if (resolved) payload.currencyCode = resolved
    }
  }

  return payload
}

async function executeByType(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  const payload = await normalizePayload(action, ctx)

  switch (action.actionType) {
    case 'create_order': {
      const parsed = orderPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid create_order payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeCreateDocumentAction(action, parsed.data, ctx, 'order')
    }
    case 'create_quote': {
      const parsed = orderPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid create_quote payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeCreateDocumentAction(action, parsed.data, ctx, 'quote')
    }
    case 'update_order': {
      const parsed = updateOrderPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid update_order payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeUpdateOrderAction(parsed.data, ctx)
    }
    case 'update_shipment': {
      const parsed = updateShipmentPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid update_shipment payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeUpdateShipmentAction(parsed.data, ctx)
    }
    case 'create_contact': {
      const parsed = createContactPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid create_contact payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeCreateContactAction(parsed.data, ctx)
    }
    case 'create_product': {
      const parsed = createProductPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid create_product payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeCreateProductAction(action, parsed.data, ctx)
    }
    case 'link_contact': {
      const parsed = linkContactPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid link_contact payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeLinkContactAction(parsed.data)
    }
    case 'log_activity': {
      const parsed = logActivityPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid log_activity payload: ${formatZodErrors(parsed.error)}`, 400)
      return executeLogActivityAction(parsed.data, ctx)
    }
    case 'draft_reply': {
      const parsed = draftReplyPayloadSchema.safeParse(payload)
      if (!parsed.success) throw new ExecutionError(`Invalid draft_reply payload: ${formatZodErrors(parsed.error)}`, 400)
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
  // Resolve channelId if not provided
  let resolvedChannelId: string | undefined = payload.channelId
  if (!resolvedChannelId) {
    resolvedChannelId = (await resolveFirstChannelId(ctx)) ?? undefined
    if (!resolvedChannelId) {
      throw new ExecutionError('No sales channel available. Create a channel first or set channelId in the payload.', 400)
    }
  }

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

  // Resolve customerEntityId: use explicit ID, or look up by email (contact may
  // have been created by a prior action in the same proposal batch)
  let resolvedCustomerEntityId = payload.customerEntityId
  if (!resolvedCustomerEntityId && payload.customerEmail) {
    resolvedCustomerEntityId = (await resolveCustomerEntityIdByEmail(ctx, payload.customerEmail)) ?? undefined
  }

  const createInput: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    customerEntityId: resolvedCustomerEntityId,
    customerReference: payload.customerReference,
    channelId: resolvedChannelId,
    currencyCode,
    taxRateId: payload.taxRateId,
    comments: payload.notes,
    metadata,
    lines,
  }

  // Only provide a manual customerSnapshot when no entity could be resolved.
  // When customerEntityId is set, the sales command builds the proper nested
  // snapshot ({ customer: {...}, contact: {...} }) from the entity itself.
  if (!resolvedCustomerEntityId) {
    createInput.customerSnapshot = {
      displayName: payload.customerName,
      ...(payload.customerEmail && { primaryEmail: payload.customerEmail }),
    }
  }

  // Address resolution: explicit address from email > addressId from CRM enrichment
  const normalizedBilling = payload.billingAddress
    ? normalizeAddressSnapshot(payload.billingAddress)
    : undefined
  const normalizedShipping = payload.shippingAddress
    ? normalizeAddressSnapshot(payload.shippingAddress)
    : undefined

  if (normalizedShipping || normalizedBilling) {
    createInput.shippingAddressSnapshot = normalizedShipping ?? normalizedBilling
    createInput.billingAddressSnapshot = normalizedBilling ?? normalizedShipping
  } else if (payload.billingAddressId || payload.shippingAddressId) {
    createInput.billingAddressId = payload.billingAddressId ?? payload.shippingAddressId
    createInput.shippingAddressId = payload.shippingAddressId ?? payload.billingAddressId
  }

  const requestedDeliveryAt = parseDateToken(payload.requestedDeliveryDate ?? undefined)
  if (requestedDeliveryAt) {
    createInput.expectedDeliveryAt = requestedDeliveryAt
  }

  const effectiveKind = kind === 'order'
    ? await resolveEffectiveDocumentKind(ctx, resolvedChannelId)
    : kind

  if (effectiveKind === 'order') {
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
    ctx,
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
  const orderLines = quantityChanges.length > 0 && quantityChanges.some((qc) => !qc.lineItemId)
    ? await loadOrderLineItems(ctx, order.id)
    : []

  for (const quantityChange of quantityChanges) {
    let lineItemId = quantityChange.lineItemId
    if (!lineItemId) {
      const matched = matchLineItemByName(orderLines, quantityChange.lineItemName)
      if (matched) {
        lineItemId = matched
      } else {
        const availableNames = orderLines.map((l) => l.name).filter(Boolean).join(', ')
        throw new ExecutionError(
          `Cannot resolve line item "${quantityChange.lineItemName}". Available line items: ${availableNames || 'none'}`,
          400,
        )
      }
    }

    await executeCommand<{ body: Record<string, unknown> }, { orderId?: string; lineId?: string }>(
      ctx,
      'sales.orders.lines.upsert',
      {
        body: {
          id: lineItemId,
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
    ctx,
    payload.orderId,
    payload.orderNumber,
  )

  const SalesShipmentClass = resolveEntityClass(ctx, 'SalesShipment')
  if (!SalesShipmentClass) {
    throw new ExecutionError('Sales module entities not available', 503)
  }

  const shipment = await findOneWithDecryption(
    ctx.em,
    SalesShipmentClass,
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
    ctx,
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
  const CustomerEntityClass = resolveEntityClass(ctx, 'CustomerEntity')
  if (payload.email && CustomerEntityClass) {
    const emailLower = payload.email.trim().toLowerCase()
    // Try direct DB lookup first (works when primaryEmail is not encrypted)
    let existingContact = await findOneWithDecryption(
      ctx.em,
      CustomerEntityClass,
      {
        primaryEmail: emailLower,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    // Fallback: in-memory email check for encrypted primaryEmail fields
    if (!existingContact) {
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
      existingContact = candidates.find(
        (e) => e.primaryEmail && e.primaryEmail.toLowerCase() === emailLower,
      ) ?? null
    }
    if (existingContact) {
      const isCompany = existingContact.kind === 'company'
      return {
        createdEntityId: existingContact.id,
        createdEntityType: isCompany ? 'customer_company' : 'customer_person',
        matchedEntityId: existingContact.id,
        matchedEntityType: isCompany ? 'company' : 'person',
      }
    }
  }

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

async function resolveUnknownContactDiscrepanciesInProposal(
  em: EntityManager,
  proposalId: string,
  contactEmail: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!contactEmail) return

  const discrepancies = await findWithDecryption(
    em,
    InboxDiscrepancy,
    {
      proposalId,
      type: 'unknown_contact',
      resolved: false,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )

  const normalizedEmail = contactEmail.trim().toLowerCase()
  const matching = discrepancies.filter((d) => {
    const foundValue = (d.foundValue || '').trim().toLowerCase()
    return foundValue === normalizedEmail
  })

  for (const d of matching) {
    d.resolved = true
  }

  if (matching.length > 0) {
    await em.flush()
  }
}

async function executeCreateProductAction(
  action: InboxProposalAction,
  payload: CreateProductPayload,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  const createInput: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    title: payload.title,
    productType: 'simple',
    isActive: true,
  }

  if (payload.sku) createInput.sku = payload.sku
  if (payload.description) createInput.description = payload.description
  if (payload.currencyCode) createInput.primaryCurrencyCode = payload.currencyCode

  const result = await executeCommand<Record<string, unknown>, { productId?: string }>(
    ctx,
    'catalog.products.create',
    createInput,
  )

  if (!result.productId) {
    throw new ExecutionError('Product creation did not return a product ID', 500)
  }

  await resolveProductDiscrepanciesInProposal(ctx.em, action.proposalId, payload.title, result.productId, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })

  return {
    createdEntityId: result.productId,
    createdEntityType: 'catalog_product',
  }
}

async function resolveProductDiscrepanciesInProposal(
  em: EntityManager,
  proposalId: string,
  productTitle: string,
  productId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
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
    await updateLineItemProductId(em, actionId, normalizedTitle, productId, scope)
  }

  if (actionIds.length > 0) {
    await em.flush()
  }
}

async function updateLineItemProductId(
  em: EntityManager,
  actionId: string,
  productName: string,
  productId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const action = await findOneWithDecryption(
    em,
    InboxProposalAction,
    { id: actionId, deletedAt: null },
    undefined,
    scope,
  )
  if (!action) return

  const payload = action.payload as Record<string, unknown>
  const lineItems = Array.isArray(payload?.lineItems)
    ? (payload.lineItems as Record<string, unknown>[])
    : []

  let updated = false
  for (const item of lineItems) {
    if (item.productId) continue
    const itemName = (typeof item.productName === 'string' ? item.productName : '').toLowerCase().trim()
    if (itemName === productName) {
      item.productId = productId
      updated = true
      break
    }
  }

  if (updated) {
    action.payload = { ...payload, lineItems }
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
    const resolved = await resolveContactIdByNameAndType(ctx, payload.contactName, payload.contactType)
    if (resolved) {
      payload = { ...payload, contactId: resolved }
    } else {
      throw new ExecutionError(
        `log_activity requires contactId — could not resolve contact "${payload.contactName}" (${payload.contactType})`,
        400,
      )
    }
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
    throw new ExecutionError(
      `No matching contact found for "${payload.to}". Create the contact first or link an existing one.`,
      400,
    )
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

async function ensureUserCanExecuteAction(action: InboxProposalAction, ctx: ExecutionContext): Promise<void> {
  const requiredFeature = getRequiredFeatureForAction(action)
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
  ctx: ExecutionContext,
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

async function resolveShipmentStatusEntryId(
  ctx: ExecutionContext,
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

async function resolveCustomerEntityIdByEmail(
  ctx: ExecutionContext,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const CustomerEntityClass = resolveEntityClass(ctx, 'CustomerEntity')
  if (!CustomerEntityClass) return null

  // Try direct DB lookup first (works when primaryEmail is not encrypted)
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

  // Fallback: in-memory email check for encrypted primaryEmail fields
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

async function resolveEffectiveDocumentKind(
  ctx: ExecutionContext,
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

async function resolveFirstChannelId(ctx: ExecutionContext): Promise<string | null> {
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

function resolveEntityClass<K extends keyof CrossModuleEntities>(
  ctx: ExecutionContext,
  key: K,
): CrossModuleEntities[K] | null {
  const fromEntities = ctx.entities?.[key]
  if (fromEntities) return fromEntities
  try { return ctx.container.resolve(key) } catch { return null }
}

async function resolveChannelCurrency(
  ctx: ExecutionContext,
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

async function resolveContactIdByNameAndType(
  ctx: ExecutionContext,
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

interface OrderLineItem {
  id: string
  name?: string | null
}

async function loadOrderLineItems(
  ctx: ExecutionContext,
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

function matchLineItemByName(
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

function normalizeDictionaryToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function splitPersonName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim()
  const parts = trimmed.split(/\s+/).filter((item) => item.length > 0)
  if (parts.length <= 1) {
    return {
      firstName: parts[0] || trimmed,
      lastName: '',
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

function normalizeAddressSnapshot(
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

function parseDateToken(value?: string | null): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

async function resolveActionDiscrepancies(
  em: EntityManager,
  actionId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const discrepancies = await findWithDecryption(
    em,
    InboxDiscrepancy,
    { actionId, resolved: false },
    undefined,
    scope,
  )
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
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const proposal = await findOneWithDecryption(
    em,
    InboxProposal,
    { id: proposalId, deletedAt: null },
    undefined,
    scope,
  )
  if (!proposal) return

  const actions = await findWithDecryption(
    em,
    InboxProposalAction,
    { proposalId, deletedAt: null },
    undefined,
    scope,
  )

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

function getRequiredFeatureForAction(action: InboxProposalAction): string {
  if (action.actionType === 'create_contact') {
    const payload = action.payload as Record<string, unknown> | null
    if (payload?.type === 'company') {
      return 'customers.companies.manage'
    }
  }
  return REQUIRED_FEATURES_MAP[action.actionType]
}
