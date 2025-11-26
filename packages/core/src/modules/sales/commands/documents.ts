import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
  SalesOrder,
  SalesOrderLine,
  SalesOrderAdjustment,
  SalesShippingMethod,
  SalesDeliveryWindow,
  SalesPaymentMethod,
  SalesDocumentTag,
  SalesDocumentTagAssignment,
  type SalesLineKind,
  type SalesAdjustmentKind,
} from '../data/entities'
import {
  CustomerAddress,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../customers/data/entities'
import {
  quoteCreateSchema,
  quoteLineCreateSchema,
  quoteAdjustmentCreateSchema,
  orderCreateSchema,
  orderLineCreateSchema,
  orderAdjustmentCreateSchema,
  type QuoteCreateInput,
  type QuoteLineCreateInput,
  type QuoteAdjustmentCreateInput,
  type OrderCreateInput,
  type OrderLineCreateInput,
  type OrderAdjustmentCreateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  toNumericString,
} from './shared'
import type { SalesCalculationService } from '../services/salesCalculationService'
import {
  type SalesLineSnapshot,
  type SalesAdjustmentDraft,
  type SalesLineCalculationResult,
  type SalesDocumentCalculationResult,
} from '../lib/types'
import { resolveDictionaryEntryValue } from '../lib/dictionaries'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'

type QuoteGraphSnapshot = {
  quote: {
    id: string
    organizationId: string
    tenantId: string
    quoteNumber: string
    statusEntryId: string | null
    status: string | null
    customerEntityId: string | null
    customerContactId: string | null
    customerSnapshot: Record<string, unknown> | null
    billingAddressId: string | null
    shippingAddressId: string | null
    billingAddressSnapshot: Record<string, unknown> | null
    shippingAddressSnapshot: Record<string, unknown> | null
    currencyCode: string
    validFrom: string | null
    validUntil: string | null
    comments: string | null
    taxInfo: Record<string, unknown> | null
    shippingMethodId: string | null
    shippingMethodCode: string | null
    deliveryWindowId: string | null
    deliveryWindowCode: string | null
    paymentMethodId: string | null
    paymentMethodCode: string | null
    channelId: string | null
    shippingMethodSnapshot: Record<string, unknown> | null
    deliveryWindowSnapshot: Record<string, unknown> | null
    paymentMethodSnapshot: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
    customFieldSetId: string | null
    subtotalNetAmount: string
    subtotalGrossAmount: string
    discountTotalAmount: string
    taxTotalAmount: string
    grandTotalNetAmount: string
    grandTotalGrossAmount: string
    lineItemCount: number
  }
  lines: QuoteLineSnapshot[]
  adjustments: QuoteAdjustmentSnapshot[]
}

type QuoteLineSnapshot = {
  id: string
  lineNumber: number
  kind: string
  statusEntryId: string | null
  status: string | null
  productId: string | null
  productVariantId: string | null
  catalogSnapshot: Record<string, unknown> | null
  name: string | null
  description: string | null
  comment: string | null
  quantity: string
  quantityUnit: string | null
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  discountAmount: string
  discountPercent: string
  taxRate: string
  taxAmount: string
  totalNetAmount: string
  totalGrossAmount: string
  configuration: Record<string, unknown> | null
  promotionCode: string | null
  promotionSnapshot: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  customFieldSetId: string | null
}

type QuoteAdjustmentSnapshot = {
  id: string
  scope: 'order' | 'line'
  kind: string
  code: string | null
  label: string | null
  calculatorKey: string | null
  promotionId: string | null
  rate: string
  amountNet: string
  amountGross: string
  currencyCode: string | null
  metadata: Record<string, unknown> | null
  position: number
  quoteLineId: string | null
}

type OrderGraphSnapshot = {
  order: {
    id: string
    organizationId: string
    tenantId: string
    orderNumber: string
    statusEntryId: string | null
    status: string | null
    fulfillmentStatusEntryId: string | null
    fulfillmentStatus: string | null
    paymentStatusEntryId: string | null
    paymentStatus: string | null
    customerEntityId: string | null
    customerContactId: string | null
    customerSnapshot: Record<string, unknown> | null
    billingAddressId: string | null
    shippingAddressId: string | null
    billingAddressSnapshot: Record<string, unknown> | null
    shippingAddressSnapshot: Record<string, unknown> | null
    currencyCode: string
    exchangeRate: string | null
    taxStrategyKey: string | null
    discountStrategyKey: string | null
    taxInfo: Record<string, unknown> | null
    shippingMethodId: string | null
    shippingMethodCode: string | null
    deliveryWindowId: string | null
    deliveryWindowCode: string | null
    paymentMethodId: string | null
    paymentMethodCode: string | null
    channelId: string | null
    placedAt: string | null
    expectedDeliveryAt: string | null
    dueAt: string | null
    comments: string | null
    internalNotes: string | null
    shippingMethodSnapshot: Record<string, unknown> | null
    deliveryWindowSnapshot: Record<string, unknown> | null
    paymentMethodSnapshot: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
    customFieldSetId: string | null
    subtotalNetAmount: string
    subtotalGrossAmount: string
    discountTotalAmount: string
    taxTotalAmount: string
    shippingNetAmount: string
    shippingGrossAmount: string
    surchargeTotalAmount: string
    grandTotalNetAmount: string
    grandTotalGrossAmount: string
    paidTotalAmount: string
    refundedTotalAmount: string
    outstandingAmount: string
    lineItemCount: number
  }
  lines: OrderLineSnapshot[]
  adjustments: OrderAdjustmentSnapshot[]
}

type OrderLineSnapshot = {
  id: string
  lineNumber: number
  kind: string
  statusEntryId: string | null
  status: string | null
  productId: string | null
  productVariantId: string | null
  catalogSnapshot: Record<string, unknown> | null
  name: string | null
  description: string | null
  comment: string | null
  quantity: string
  quantityUnit: string | null
  reservedQuantity: string
  fulfilledQuantity: string
  invoicedQuantity: string
  returnedQuantity: string
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  discountAmount: string
  discountPercent: string
  taxRate: string
  taxAmount: string
  totalNetAmount: string
  totalGrossAmount: string
  configuration: Record<string, unknown> | null
  promotionCode: string | null
  promotionSnapshot: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  customFieldSetId: string | null
}

type OrderAdjustmentSnapshot = {
  id: string
  scope: 'order' | 'line'
  kind: string
  code: string | null
  label: string | null
  calculatorKey: string | null
  promotionId: string | null
  rate: string
  amountNet: string
  amountGross: string
  currencyCode: string | null
  metadata: Record<string, unknown> | null
  position: number
  orderLineId: string | null
}

type OrderUndoPayload = {
  before?: OrderGraphSnapshot | null
  after?: OrderGraphSnapshot | null
}

type QuoteUndoPayload = {
  before?: QuoteGraphSnapshot | null
  after?: QuoteGraphSnapshot | null
}

type DocumentLineCreateInput = QuoteLineCreateInput | OrderLineCreateInput
type DocumentAdjustmentCreateInput = QuoteAdjustmentCreateInput | OrderAdjustmentCreateInput

function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

async function resolveCustomerSnapshot(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  customerEntityId?: string | null,
  customerContactId?: string | null
): Promise<Record<string, unknown> | null> {
  if (!customerEntityId) return null
  const customer = await em.findOne(
    CustomerEntity,
    { id: customerEntityId, organizationId, tenantId },
    { populate: ['personProfile', 'companyProfile'] }
  )
  if (!customer) return null

  const contact = customerContactId
    ? await em.findOne(CustomerPersonProfile, {
        id: customerContactId,
        organizationId,
        tenantId,
      })
    : null

  return {
    customer: {
      id: customer.id,
      kind: customer.kind,
      displayName: customer.displayName,
      primaryEmail: customer.primaryEmail ?? null,
      primaryPhone: customer.primaryPhone ?? null,
      personProfile: customer.personProfile
        ? {
            id: customer.personProfile.id,
            firstName: customer.personProfile.firstName ?? null,
            lastName: customer.personProfile.lastName ?? null,
            preferredName: customer.personProfile.preferredName ?? null,
          }
        : null,
      companyProfile: customer.companyProfile
        ? {
            id: customer.companyProfile.id,
            legalName: customer.companyProfile.legalName ?? null,
            brandName: customer.companyProfile.brandName ?? null,
            domain: customer.companyProfile.domain ?? null,
            websiteUrl: customer.companyProfile.websiteUrl ?? null,
          }
        : null,
    },
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          preferredName: contact.preferredName ?? null,
          jobTitle: contact.jobTitle ?? null,
          department: contact.department ?? null,
        }
      : null,
  }
}

async function resolveAddressSnapshot(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  addressId?: string | null
): Promise<Record<string, unknown> | null> {
  if (!addressId) return null
  const address = await em.findOne(CustomerAddress, {
    id: addressId,
    organizationId,
    tenantId,
  })
  if (!address) return null

  return {
    id: address.id,
    name: address.name ?? null,
    purpose: address.purpose ?? null,
    companyName: address.companyName ?? null,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    buildingNumber: address.buildingNumber ?? null,
    flatNumber: address.flatNumber ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    isPrimary: address.isPrimary,
  }
}

async function resolveDocumentReferences(
  em: EntityManager,
  parsed: {
    organizationId: string
    tenantId: string
    customerEntityId?: string | null
    customerContactId?: string | null
    customerSnapshot?: Record<string, unknown> | null
    billingAddressId?: string | null
    shippingAddressId?: string | null
    billingAddressSnapshot?: Record<string, unknown> | null
    shippingAddressSnapshot?: Record<string, unknown> | null
    shippingMethodId?: string | null
    deliveryWindowId?: string | null
    paymentMethodId?: string | null
  }
): Promise<{
  customerSnapshot: Record<string, unknown> | null
  billingAddressSnapshot: Record<string, unknown> | null
  shippingAddressSnapshot: Record<string, unknown> | null
  shippingMethod: SalesShippingMethod | null
  deliveryWindow: SalesDeliveryWindow | null
  paymentMethod: SalesPaymentMethod | null
}> {
  const [
    resolvedCustomerSnapshot,
    resolvedBillingSnapshot,
    resolvedShippingSnapshot,
    shippingMethod,
    deliveryWindow,
    paymentMethod,
  ] = await Promise.all([
    parsed.customerSnapshot
      ? Promise.resolve(cloneJson(parsed.customerSnapshot))
      : resolveCustomerSnapshot(
          em,
          parsed.organizationId,
          parsed.tenantId,
          parsed.customerEntityId ?? null,
          parsed.customerContactId ?? null
        ),
    parsed.billingAddressSnapshot
      ? Promise.resolve(cloneJson(parsed.billingAddressSnapshot))
      : resolveAddressSnapshot(
          em,
          parsed.organizationId,
          parsed.tenantId,
          parsed.billingAddressId ?? null
        ),
    parsed.shippingAddressSnapshot
      ? Promise.resolve(cloneJson(parsed.shippingAddressSnapshot))
      : resolveAddressSnapshot(
          em,
          parsed.organizationId,
          parsed.tenantId,
          parsed.shippingAddressId ?? null
        ),
    parsed.shippingMethodId
      ? em.findOne(SalesShippingMethod, {
          id: parsed.shippingMethodId,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
        })
      : Promise.resolve(null),
    parsed.deliveryWindowId
      ? em.findOne(SalesDeliveryWindow, {
          id: parsed.deliveryWindowId,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
        })
      : Promise.resolve(null),
    parsed.paymentMethodId
      ? em.findOne(SalesPaymentMethod, {
          id: parsed.paymentMethodId,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
        })
      : Promise.resolve(null),
  ])

  return {
    customerSnapshot: resolvedCustomerSnapshot ? cloneJson(resolvedCustomerSnapshot) : null,
    billingAddressSnapshot: resolvedBillingSnapshot ? cloneJson(resolvedBillingSnapshot) : null,
    shippingAddressSnapshot: resolvedShippingSnapshot ? cloneJson(resolvedShippingSnapshot) : null,
    shippingMethod: shippingMethod ?? null,
    deliveryWindow: deliveryWindow ?? null,
    paymentMethod: paymentMethod ?? null,
  }
}

async function loadQuoteSnapshot(em: EntityManager, id: string): Promise<QuoteGraphSnapshot | null> {
  const quote = await em.findOne(SalesQuote, { id, deletedAt: null })
  if (!quote) return null
  const lines = await em.find(SalesQuoteLine, { quote: quote }, { orderBy: { lineNumber: 'asc' } })
  const adjustments = await em.find(SalesQuoteAdjustment, { quote: quote }, { orderBy: { position: 'asc' } })

  return {
    quote: {
      id: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteNumber: quote.quoteNumber,
      statusEntryId: quote.statusEntryId ?? null,
      status: quote.status ?? null,
      customerEntityId: quote.customerEntityId ?? null,
      customerContactId: quote.customerContactId ?? null,
      customerSnapshot: quote.customerSnapshot ? cloneJson(quote.customerSnapshot) : null,
      billingAddressId: quote.billingAddressId ?? null,
      shippingAddressId: quote.shippingAddressId ?? null,
      billingAddressSnapshot: quote.billingAddressSnapshot ? cloneJson(quote.billingAddressSnapshot) : null,
      shippingAddressSnapshot: quote.shippingAddressSnapshot ? cloneJson(quote.shippingAddressSnapshot) : null,
      currencyCode: quote.currencyCode,
      validFrom: quote.validFrom ? quote.validFrom.toISOString() : null,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      comments: quote.comments ?? null,
      taxInfo: quote.taxInfo ? cloneJson(quote.taxInfo) : null,
      shippingMethodId: quote.shippingMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      deliveryWindowId: quote.deliveryWindowId ?? null,
      deliveryWindowCode: quote.deliveryWindowCode ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
      channelId: quote.channelId ?? null,
      shippingMethodSnapshot: quote.shippingMethodSnapshot ? cloneJson(quote.shippingMethodSnapshot) : null,
      deliveryWindowSnapshot: quote.deliveryWindowSnapshot ? cloneJson(quote.deliveryWindowSnapshot) : null,
      paymentMethodSnapshot: quote.paymentMethodSnapshot ? cloneJson(quote.paymentMethodSnapshot) : null,
      metadata: quote.metadata ? cloneJson(quote.metadata) : null,
      customFieldSetId: quote.customFieldSetId ?? null,
      subtotalNetAmount: quote.subtotalNetAmount,
      subtotalGrossAmount: quote.subtotalGrossAmount,
      discountTotalAmount: quote.discountTotalAmount,
      taxTotalAmount: quote.taxTotalAmount,
      grandTotalNetAmount: quote.grandTotalNetAmount,
      grandTotalGrossAmount: quote.grandTotalGrossAmount,
      lineItemCount: quote.lineItemCount,
    },
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      kind: line.kind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
    })),
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      scope: adj.scope,
      kind: adj.kind,
      code: adj.code ?? null,
      label: adj.label ?? null,
      calculatorKey: adj.calculatorKey ?? null,
      promotionId: adj.promotionId ?? null,
      rate: adj.rate,
      amountNet: adj.amountNet,
      amountGross: adj.amountGross,
      currencyCode: adj.currencyCode ?? null,
      metadata: adj.metadata ? cloneJson(adj.metadata) : null,
      position: adj.position,
      quoteLineId: typeof adj.quoteLine === 'string' ? adj.quoteLine : adj.quoteLine?.id ?? null,
    })),
  }
}

async function loadOrderSnapshot(em: EntityManager, id: string): Promise<OrderGraphSnapshot | null> {
  const order = await em.findOne(SalesOrder, { id, deletedAt: null })
  if (!order) return null
  const lines = await em.find(SalesOrderLine, { order: order }, { orderBy: { lineNumber: 'asc' } })
  const adjustments = await em.find(SalesOrderAdjustment, { order: order }, { orderBy: { position: 'asc' } })

  return {
    order: {
      id: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderNumber: order.orderNumber,
      statusEntryId: order.statusEntryId ?? null,
      status: order.status ?? null,
      fulfillmentStatusEntryId: order.fulfillmentStatusEntryId ?? null,
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      paymentStatusEntryId: order.paymentStatusEntryId ?? null,
      paymentStatus: order.paymentStatus ?? null,
      customerEntityId: order.customerEntityId ?? null,
      customerContactId: order.customerContactId ?? null,
      customerSnapshot: order.customerSnapshot ? cloneJson(order.customerSnapshot) : null,
      billingAddressId: order.billingAddressId ?? null,
      shippingAddressId: order.shippingAddressId ?? null,
      billingAddressSnapshot: order.billingAddressSnapshot ? cloneJson(order.billingAddressSnapshot) : null,
      shippingAddressSnapshot: order.shippingAddressSnapshot ? cloneJson(order.shippingAddressSnapshot) : null,
      currencyCode: order.currencyCode,
      exchangeRate: order.exchangeRate ?? null,
      taxStrategyKey: order.taxStrategyKey ?? null,
      discountStrategyKey: order.discountStrategyKey ?? null,
      taxInfo: order.taxInfo ? cloneJson(order.taxInfo) : null,
      shippingMethodId: order.shippingMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      deliveryWindowId: order.deliveryWindowId ?? null,
      deliveryWindowCode: order.deliveryWindowCode ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
      channelId: order.channelId ?? null,
      placedAt: order.placedAt ? order.placedAt.toISOString() : null,
      expectedDeliveryAt: order.expectedDeliveryAt ? order.expectedDeliveryAt.toISOString() : null,
      dueAt: order.dueAt ? order.dueAt.toISOString() : null,
      comments: order.comments ?? null,
      internalNotes: order.internalNotes ?? null,
      shippingMethodSnapshot: order.shippingMethodSnapshot ? cloneJson(order.shippingMethodSnapshot) : null,
      deliveryWindowSnapshot: order.deliveryWindowSnapshot ? cloneJson(order.deliveryWindowSnapshot) : null,
      paymentMethodSnapshot: order.paymentMethodSnapshot ? cloneJson(order.paymentMethodSnapshot) : null,
      metadata: order.metadata ? cloneJson(order.metadata) : null,
      customFieldSetId: order.customFieldSetId ?? null,
      subtotalNetAmount: order.subtotalNetAmount,
      subtotalGrossAmount: order.subtotalGrossAmount,
      discountTotalAmount: order.discountTotalAmount,
      taxTotalAmount: order.taxTotalAmount,
      shippingNetAmount: order.shippingNetAmount,
      shippingGrossAmount: order.shippingGrossAmount,
      surchargeTotalAmount: order.surchargeTotalAmount,
      grandTotalNetAmount: order.grandTotalNetAmount,
      grandTotalGrossAmount: order.grandTotalGrossAmount,
      paidTotalAmount: order.paidTotalAmount,
      refundedTotalAmount: order.refundedTotalAmount,
      outstandingAmount: order.outstandingAmount,
      lineItemCount: order.lineItemCount,
    },
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      kind: line.kind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      reservedQuantity: line.reservedQuantity,
      fulfilledQuantity: line.fulfilledQuantity,
      invoicedQuantity: line.invoicedQuantity,
      returnedQuantity: line.returnedQuantity,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
    })),
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      scope: adj.scope,
      kind: adj.kind,
      code: adj.code ?? null,
      label: adj.label ?? null,
      calculatorKey: adj.calculatorKey ?? null,
      promotionId: adj.promotionId ?? null,
      rate: adj.rate,
      amountNet: adj.amountNet,
      amountGross: adj.amountGross,
      currencyCode: adj.currencyCode ?? null,
      metadata: adj.metadata ? cloneJson(adj.metadata) : null,
      position: adj.position,
      orderLineId: typeof adj.orderLine === 'string' ? adj.orderLine : adj.orderLine?.id ?? null,
    })),
  }
}

function createLineSnapshotFromInput(
  line: DocumentLineCreateInput,
  lineNumber: number
): SalesLineSnapshot {
  return {
    lineNumber,
    kind: line.kind ?? 'product',
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: Number(line.quantity ?? 0),
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode,
    unitPriceNet: line.unitPriceNet ?? null,
    unitPriceGross: line.unitPriceGross ?? null,
    discountAmount: line.discountAmount ?? null,
    discountPercent: line.discountPercent ?? null,
    taxRate: line.taxRate ?? null,
    taxAmount: line.taxAmount ?? null,
    totalNetAmount: line.totalNetAmount ?? null,
    totalGrossAmount: line.totalGrossAmount ?? null,
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
  }
}

function createAdjustmentDraftFromInput(
  adjustment: DocumentAdjustmentCreateInput
): SalesAdjustmentDraft {
  const lineRef =
    'quoteLineId' in adjustment
      ? (adjustment as any).quoteLineId
      : (adjustment as any).orderLineId
  if (adjustment.scope === 'line' && lineRef) {
    throw new CrudHttpError(400, { error: 'Line-scoped adjustments are not supported yet.' })
  }
  return {
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind ?? 'custom',
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: adjustment.rate ?? null,
    amountNet: adjustment.amountNet ?? null,
    amountGross: adjustment.amountGross ?? null,
    currencyCode: adjustment.currencyCode ?? null,
    metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
    position: adjustment.position ?? 0,
  }
}

function convertLineCalculationToEntityInput(
  lineResult: SalesLineCalculationResult,
  sourceLine: DocumentLineCreateInput,
  document: { organizationId: string; tenantId: string },
  index: number
) {
  const line = lineResult.line
  return {
    lineNumber: line.lineNumber ?? index + 1,
    kind: line.kind ?? 'product',
    statusEntryId: sourceLine.statusEntryId ?? null,
    productId: sourceLine.productId ?? null,
    productVariantId: sourceLine.productVariantId ?? null,
    catalogSnapshot: sourceLine.catalogSnapshot ? cloneJson(sourceLine.catalogSnapshot) : null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: toNumericString(line.quantity) ?? '0',
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode,
    unitPriceNet:
      toNumericString(line.unitPriceNet ?? (lineResult.netAmount / Math.max(line.quantity || 1, 1))) ??
      '0',
    unitPriceGross:
      toNumericString(
        line.unitPriceGross ?? (lineResult.grossAmount / Math.max(line.quantity || 1, 1))
      ) ?? '0',
    discountAmount: toNumericString(lineResult.discountAmount) ?? '0',
    discountPercent: toNumericString(line.discountPercent) ?? '0',
    taxRate: toNumericString(line.taxRate) ?? '0',
    taxAmount: toNumericString(lineResult.taxAmount) ?? '0',
    totalNetAmount: toNumericString(lineResult.netAmount) ?? '0',
    totalGrossAmount: toNumericString(lineResult.grossAmount) ?? '0',
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    promotionSnapshot: sourceLine.promotionSnapshot ? cloneJson(sourceLine.promotionSnapshot) : null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: sourceLine.customFieldSetId ?? null,
    organizationId: document.organizationId,
    tenantId: document.tenantId,
  }
}

function convertAdjustmentResultToEntityInput(
  adjustment: SalesAdjustmentDraft,
  sourceAdjustment: DocumentAdjustmentCreateInput | null,
  document: { organizationId: string; tenantId: string },
  index: number
) {
  const metadata = adjustment.metadata ? cloneJson(adjustment.metadata) : null
  return {
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind ?? 'custom',
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: toNumericString(adjustment.rate) ?? '0',
    amountNet: toNumericString(adjustment.amountNet) ?? '0',
    amountGross: toNumericString(adjustment.amountGross ?? adjustment.amountNet) ?? '0',
    currencyCode: adjustment.currencyCode ?? null,
    metadata,
    position: sourceAdjustment?.position ?? index,
    organizationId: document.organizationId,
    tenantId: document.tenantId,
  }
}

async function replaceQuoteLines(
  em: EntityManager,
  quote: SalesQuote,
  calculation: SalesDocumentCalculationResult,
  lineInputs: QuoteLineCreateInput[]
): Promise<void> {
  await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
  const statusCache = new Map<string, string | null>()
  const resolveStatus = async (entryId?: string | null) => {
    if (!entryId) return null
    if (statusCache.has(entryId)) return statusCache.get(entryId) ?? null
    const value = await resolveDictionaryEntryValue(em, entryId)
    statusCache.set(entryId, value)
    return value
  }
  for (let index = 0; index < calculation.lines.length; index += 1) {
    const lineResult = calculation.lines[index]
    const sourceLine = lineInputs[index]
    const entityInput = convertLineCalculationToEntityInput(lineResult, sourceLine, quote, index)
    const statusValue = await resolveStatus(sourceLine.statusEntryId ?? null)
    const lineEntity = em.create(SalesQuoteLine, {
      quote,
      ...entityInput,
      status: statusValue,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
  }
}

async function replaceQuoteAdjustments(
  em: EntityManager,
  quote: SalesQuote,
  calculation: SalesDocumentCalculationResult,
  adjustmentInputs: QuoteAdjustmentCreateInput[] | null
): Promise<void> {
  await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
  const adjustmentDrafts = calculation.adjustments
  adjustmentDrafts.forEach((draft, index) => {
    const source = adjustmentInputs ? adjustmentInputs[index] ?? null : null
    const entityInput = convertAdjustmentResultToEntityInput(
      draft,
      source,
      quote,
      index
    )
    const adjustmentEntity = em.create(SalesQuoteAdjustment, {
      quote,
      ...entityInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    adjustmentEntity.quoteLine = null
    em.persist(adjustmentEntity)
  })
}

async function replaceOrderLines(
  em: EntityManager,
  order: SalesOrder,
  calculation: SalesDocumentCalculationResult,
  lineInputs: OrderLineCreateInput[]
): Promise<void> {
  await em.nativeDelete(SalesOrderLine, { order: order.id })
  const statusCache = new Map<string, string | null>()
  const resolveStatus = async (entryId?: string | null) => {
    if (!entryId) return null
    if (statusCache.has(entryId)) return statusCache.get(entryId) ?? null
    const value = await resolveDictionaryEntryValue(em, entryId)
    statusCache.set(entryId, value)
    return value
  }
  for (let index = 0; index < calculation.lines.length; index += 1) {
    const lineResult = calculation.lines[index]
    const sourceLine = lineInputs[index]
    const entityInput = convertLineCalculationToEntityInput(lineResult, sourceLine, order, index)
    const statusValue = await resolveStatus(sourceLine.statusEntryId ?? null)
    const lineEntity = em.create(SalesOrderLine, {
      order,
      ...entityInput,
      reservedQuantity: '0',
      fulfilledQuantity: '0',
      invoicedQuantity: '0',
      returnedQuantity: '0',
      status: statusValue,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
  }
}

async function replaceOrderAdjustments(
  em: EntityManager,
  order: SalesOrder,
  calculation: SalesDocumentCalculationResult,
  adjustmentInputs: OrderAdjustmentCreateInput[] | null
): Promise<void> {
  await em.nativeDelete(SalesOrderAdjustment, { order: order.id })
  const adjustmentDrafts = calculation.adjustments
  adjustmentDrafts.forEach((draft, index) => {
    const source = adjustmentInputs ? adjustmentInputs[index] ?? null : null
    const entityInput = convertAdjustmentResultToEntityInput(
      draft,
      source,
      order,
      index
    )
    const adjustmentEntity = em.create(SalesOrderAdjustment, {
      order,
      ...entityInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    adjustmentEntity.orderLine = null
    em.persist(adjustmentEntity)
  })
}

function applyQuoteTotals(
  quote: SalesQuote,
  totals: SalesDocumentCalculationResult['totals'],
  lineCount: number
): void {
  quote.subtotalNetAmount = toNumericString(totals.subtotalNetAmount) ?? '0'
  quote.subtotalGrossAmount = toNumericString(totals.subtotalGrossAmount) ?? '0'
  quote.discountTotalAmount = toNumericString(totals.discountTotalAmount) ?? '0'
  quote.taxTotalAmount = toNumericString(totals.taxTotalAmount) ?? '0'
  quote.grandTotalNetAmount = toNumericString(totals.grandTotalNetAmount) ?? '0'
  quote.grandTotalGrossAmount = toNumericString(totals.grandTotalGrossAmount) ?? '0'
  quote.lineItemCount = lineCount
}

function applyOrderTotals(
  order: SalesOrder,
  totals: SalesDocumentCalculationResult['totals'],
  lineCount: number
): void {
  order.subtotalNetAmount = toNumericString(totals.subtotalNetAmount) ?? '0'
  order.subtotalGrossAmount = toNumericString(totals.subtotalGrossAmount) ?? '0'
  order.discountTotalAmount = toNumericString(totals.discountTotalAmount) ?? '0'
  order.taxTotalAmount = toNumericString(totals.taxTotalAmount) ?? '0'
  order.shippingNetAmount = toNumericString(totals.shippingNetAmount) ?? '0'
  order.shippingGrossAmount = toNumericString(totals.shippingGrossAmount) ?? '0'
  order.surchargeTotalAmount = toNumericString(totals.surchargeTotalAmount) ?? '0'
  order.grandTotalNetAmount = toNumericString(totals.grandTotalNetAmount) ?? '0'
  order.grandTotalGrossAmount = toNumericString(totals.grandTotalGrossAmount) ?? '0'
  order.paidTotalAmount = toNumericString(totals.paidTotalAmount) ?? '0'
  order.refundedTotalAmount = toNumericString(totals.refundedTotalAmount) ?? '0'
  order.outstandingAmount = toNumericString(totals.outstandingAmount) ?? '0'
  order.lineItemCount = lineCount
}

function ensureQuoteScope(ctx: Parameters<typeof ensureTenantScope>[0], organizationId: string, tenantId: string): void {
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
}

function ensureOrderScope(ctx: Parameters<typeof ensureTenantScope>[0], organizationId: string, tenantId: string): void {
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
}

function normalizeTagIds(tags?: Array<string | null | undefined>): string[] {
  if (!Array.isArray(tags)) return []
  const set = new Set<string>()
  tags.forEach((id) => {
    if (typeof id === 'string' && id.trim().length > 0) set.add(id.trim())
  })
  return Array.from(set)
}

async function syncSalesDocumentTags(em: EntityManager, params: {
  documentId: string
  kind: SalesDocumentKind
  organizationId: string
  tenantId: string
  tagIds?: Array<string | null | undefined> | null
}) {
  if (params.tagIds === undefined) return
  const tagIds = normalizeTagIds(params.tagIds)
  if (tagIds.length === 0) {
    await em.nativeDelete(SalesDocumentTagAssignment, { documentId: params.documentId, documentKind: params.kind })
    return
  }
  const tagsInScope = await em.find(SalesDocumentTag, {
    id: { $in: tagIds },
    organizationId: params.organizationId,
    tenantId: params.tenantId,
  })
  if (tagsInScope.length !== tagIds.length) {
    throw new CrudHttpError(400, { error: 'One or more tags not found for this scope' })
  }
  const byId = new Map(tagsInScope.map((tag) => [tag.id, tag]))
  await em.nativeDelete(SalesDocumentTagAssignment, { documentId: params.documentId, documentKind: params.kind })
  for (const tagId of tagIds) {
    const tag = byId.get(tagId)
    if (!tag) continue
    const assignment = em.create(SalesDocumentTagAssignment, {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      documentId: params.documentId,
      documentKind: params.kind,
      tag,
      order: params.kind === 'order' ? em.getReference(SalesOrder, params.documentId) : null,
      quote: params.kind === 'quote' ? em.getReference(SalesQuote, params.documentId) : null,
    })
    em.persist(assignment)
  }
}

function applyQuoteSnapshot(quote: SalesQuote, snapshot: QuoteGraphSnapshot['quote']): void {
  quote.organizationId = snapshot.organizationId
  quote.tenantId = snapshot.tenantId
  quote.quoteNumber = snapshot.quoteNumber
  quote.statusEntryId = snapshot.statusEntryId ?? null
  quote.status = snapshot.status ?? null
  quote.customerEntityId = snapshot.customerEntityId ?? null
  quote.customerContactId = snapshot.customerContactId ?? null
  quote.customerSnapshot = snapshot.customerSnapshot ? cloneJson(snapshot.customerSnapshot) : null
  quote.billingAddressId = snapshot.billingAddressId ?? null
  quote.shippingAddressId = snapshot.shippingAddressId ?? null
  quote.billingAddressSnapshot = snapshot.billingAddressSnapshot ? cloneJson(snapshot.billingAddressSnapshot) : null
  quote.shippingAddressSnapshot = snapshot.shippingAddressSnapshot
    ? cloneJson(snapshot.shippingAddressSnapshot)
    : null
  quote.currencyCode = snapshot.currencyCode
  quote.validFrom = snapshot.validFrom ? new Date(snapshot.validFrom) : null
  quote.validUntil = snapshot.validUntil ? new Date(snapshot.validUntil) : null
  quote.comments = snapshot.comments ?? null
  quote.taxInfo = snapshot.taxInfo ? cloneJson(snapshot.taxInfo) : null
  quote.shippingMethodId = snapshot.shippingMethodId ?? null
  quote.shippingMethodCode = snapshot.shippingMethodCode ?? null
  quote.deliveryWindowId = snapshot.deliveryWindowId ?? null
  quote.deliveryWindowCode = snapshot.deliveryWindowCode ?? null
  quote.paymentMethodId = snapshot.paymentMethodId ?? null
  quote.paymentMethodCode = snapshot.paymentMethodCode ?? null
  quote.shippingMethodSnapshot = snapshot.shippingMethodSnapshot ? cloneJson(snapshot.shippingMethodSnapshot) : null
  quote.deliveryWindowSnapshot = snapshot.deliveryWindowSnapshot
    ? cloneJson(snapshot.deliveryWindowSnapshot)
    : null
  quote.paymentMethodSnapshot = snapshot.paymentMethodSnapshot ? cloneJson(snapshot.paymentMethodSnapshot) : null
  quote.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  quote.channelId = snapshot.channelId ?? null
  quote.customFieldSetId = snapshot.customFieldSetId ?? null
  quote.subtotalNetAmount = snapshot.subtotalNetAmount
  quote.subtotalGrossAmount = snapshot.subtotalGrossAmount
  quote.discountTotalAmount = snapshot.discountTotalAmount
  quote.taxTotalAmount = snapshot.taxTotalAmount
  quote.grandTotalNetAmount = snapshot.grandTotalNetAmount
  quote.grandTotalGrossAmount = snapshot.grandTotalGrossAmount
  quote.lineItemCount = snapshot.lineItemCount
}

function applyOrderSnapshot(order: SalesOrder, snapshot: OrderGraphSnapshot['order']): void {
  order.organizationId = snapshot.organizationId
  order.tenantId = snapshot.tenantId
  order.orderNumber = snapshot.orderNumber
  order.statusEntryId = snapshot.statusEntryId ?? null
  order.status = snapshot.status ?? null
  order.fulfillmentStatusEntryId = snapshot.fulfillmentStatusEntryId ?? null
  order.fulfillmentStatus = snapshot.fulfillmentStatus ?? null
  order.paymentStatusEntryId = snapshot.paymentStatusEntryId ?? null
  order.paymentStatus = snapshot.paymentStatus ?? null
  order.customerEntityId = snapshot.customerEntityId ?? null
  order.customerContactId = snapshot.customerContactId ?? null
  order.customerSnapshot = snapshot.customerSnapshot ? cloneJson(snapshot.customerSnapshot) : null
  order.billingAddressId = snapshot.billingAddressId ?? null
  order.shippingAddressId = snapshot.shippingAddressId ?? null
  order.billingAddressSnapshot = snapshot.billingAddressSnapshot ? cloneJson(snapshot.billingAddressSnapshot) : null
  order.shippingAddressSnapshot = snapshot.shippingAddressSnapshot
    ? cloneJson(snapshot.shippingAddressSnapshot)
    : null
  order.currencyCode = snapshot.currencyCode
  order.exchangeRate = snapshot.exchangeRate ?? null
  order.taxStrategyKey = snapshot.taxStrategyKey ?? null
  order.discountStrategyKey = snapshot.discountStrategyKey ?? null
  order.taxInfo = snapshot.taxInfo ? cloneJson(snapshot.taxInfo) : null
  order.shippingMethodId = snapshot.shippingMethodId ?? null
  order.shippingMethodCode = snapshot.shippingMethodCode ?? null
  order.deliveryWindowId = snapshot.deliveryWindowId ?? null
  order.deliveryWindowCode = snapshot.deliveryWindowCode ?? null
  order.paymentMethodId = snapshot.paymentMethodId ?? null
  order.paymentMethodCode = snapshot.paymentMethodCode ?? null
  order.channelId = snapshot.channelId ?? null
  order.placedAt = snapshot.placedAt ? new Date(snapshot.placedAt) : null
  order.expectedDeliveryAt = snapshot.expectedDeliveryAt ? new Date(snapshot.expectedDeliveryAt) : null
  order.dueAt = snapshot.dueAt ? new Date(snapshot.dueAt) : null
  order.comments = snapshot.comments ?? null
  order.internalNotes = snapshot.internalNotes ?? null
  order.shippingMethodSnapshot = snapshot.shippingMethodSnapshot ? cloneJson(snapshot.shippingMethodSnapshot) : null
  order.deliveryWindowSnapshot = snapshot.deliveryWindowSnapshot
    ? cloneJson(snapshot.deliveryWindowSnapshot)
    : null
  order.paymentMethodSnapshot = snapshot.paymentMethodSnapshot ? cloneJson(snapshot.paymentMethodSnapshot) : null
  order.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  order.customFieldSetId = snapshot.customFieldSetId ?? null
  order.subtotalNetAmount = snapshot.subtotalNetAmount
  order.subtotalGrossAmount = snapshot.subtotalGrossAmount
  order.discountTotalAmount = snapshot.discountTotalAmount
  order.taxTotalAmount = snapshot.taxTotalAmount
  order.shippingNetAmount = snapshot.shippingNetAmount
  order.shippingGrossAmount = snapshot.shippingGrossAmount
  order.surchargeTotalAmount = snapshot.surchargeTotalAmount
  order.grandTotalNetAmount = snapshot.grandTotalNetAmount
  order.grandTotalGrossAmount = snapshot.grandTotalGrossAmount
  order.paidTotalAmount = snapshot.paidTotalAmount
  order.refundedTotalAmount = snapshot.refundedTotalAmount
  order.outstandingAmount = snapshot.outstandingAmount
  order.lineItemCount = snapshot.lineItemCount
}

async function restoreQuoteGraph(
  em: EntityManager,
  snapshot: QuoteGraphSnapshot
): Promise<SalesQuote> {
  let quote = await em.findOne(SalesQuote, { id: snapshot.quote.id })
  if (!quote) {
    quote = em.create(SalesQuote, {
      id: snapshot.quote.id,
      organizationId: snapshot.quote.organizationId,
      tenantId: snapshot.quote.tenantId,
      quoteNumber: snapshot.quote.quoteNumber,
      statusEntryId: snapshot.quote.statusEntryId ?? null,
      status: snapshot.quote.status ?? null,
      customerEntityId: snapshot.quote.customerEntityId ?? null,
      customerContactId: snapshot.quote.customerContactId ?? null,
      customerSnapshot: snapshot.quote.customerSnapshot ? cloneJson(snapshot.quote.customerSnapshot) : null,
      billingAddressId: snapshot.quote.billingAddressId ?? null,
      shippingAddressId: snapshot.quote.shippingAddressId ?? null,
      billingAddressSnapshot: snapshot.quote.billingAddressSnapshot
        ? cloneJson(snapshot.quote.billingAddressSnapshot)
        : null,
      shippingAddressSnapshot: snapshot.quote.shippingAddressSnapshot
        ? cloneJson(snapshot.quote.shippingAddressSnapshot)
        : null,
      currencyCode: snapshot.quote.currencyCode,
      validFrom: snapshot.quote.validFrom ? new Date(snapshot.quote.validFrom) : null,
      validUntil: snapshot.quote.validUntil ? new Date(snapshot.quote.validUntil) : null,
      comments: snapshot.quote.comments ?? null,
      taxInfo: snapshot.quote.taxInfo ? cloneJson(snapshot.quote.taxInfo) : null,
      shippingMethodId: snapshot.quote.shippingMethodId ?? null,
      shippingMethodCode: snapshot.quote.shippingMethodCode ?? null,
      deliveryWindowId: snapshot.quote.deliveryWindowId ?? null,
      deliveryWindowCode: snapshot.quote.deliveryWindowCode ?? null,
      paymentMethodId: snapshot.quote.paymentMethodId ?? null,
      paymentMethodCode: snapshot.quote.paymentMethodCode ?? null,
      shippingMethodSnapshot: snapshot.quote.shippingMethodSnapshot
        ? cloneJson(snapshot.quote.shippingMethodSnapshot)
        : null,
      deliveryWindowSnapshot: snapshot.quote.deliveryWindowSnapshot
        ? cloneJson(snapshot.quote.deliveryWindowSnapshot)
        : null,
      paymentMethodSnapshot: snapshot.quote.paymentMethodSnapshot
        ? cloneJson(snapshot.quote.paymentMethodSnapshot)
        : null,
      metadata: snapshot.quote.metadata ? cloneJson(snapshot.quote.metadata) : null,
      channelId: snapshot.quote.channelId ?? null,
      customFieldSetId: snapshot.quote.customFieldSetId ?? null,
      subtotalNetAmount: snapshot.quote.subtotalNetAmount,
      subtotalGrossAmount: snapshot.quote.subtotalGrossAmount,
      discountTotalAmount: snapshot.quote.discountTotalAmount,
      taxTotalAmount: snapshot.quote.taxTotalAmount,
      grandTotalNetAmount: snapshot.quote.grandTotalNetAmount,
      grandTotalGrossAmount: snapshot.quote.grandTotalGrossAmount,
      lineItemCount: snapshot.quote.lineItemCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(quote)
  }
  applyQuoteSnapshot(quote, snapshot.quote)
  await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
  await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })

  snapshot.lines.forEach((line) => {
    const lineEntity = em.create(SalesQuoteLine, {
      id: line.id,
      quote,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      lineNumber: line.lineNumber,
      kind: line.kind as SalesLineKind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
  })

  snapshot.adjustments.forEach((adjustment, index) => {
    const adjustmentEntity = em.create(SalesQuoteAdjustment, {
      id: adjustment.id,
      quote,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      scope: adjustment.scope,
      kind: adjustment.kind as SalesAdjustmentKind,
      code: adjustment.code ?? null,
      label: adjustment.label ?? null,
      calculatorKey: adjustment.calculatorKey ?? null,
      promotionId: adjustment.promotionId ?? null,
      rate: adjustment.rate,
      amountNet: adjustment.amountNet,
      amountGross: adjustment.amountGross,
      currencyCode: adjustment.currencyCode ?? null,
      metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
      position: adjustment.position ?? index,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    adjustmentEntity.quoteLine = null
    em.persist(adjustmentEntity)
  })

  return quote
}

async function restoreOrderGraph(
  em: EntityManager,
  snapshot: OrderGraphSnapshot
): Promise<SalesOrder> {
  let order = await em.findOne(SalesOrder, { id: snapshot.order.id })
  if (!order) {
    order = em.create(SalesOrder, {
      id: snapshot.order.id,
      organizationId: snapshot.order.organizationId,
      tenantId: snapshot.order.tenantId,
      orderNumber: snapshot.order.orderNumber,
      statusEntryId: snapshot.order.statusEntryId ?? null,
      status: snapshot.order.status ?? null,
      fulfillmentStatusEntryId: snapshot.order.fulfillmentStatusEntryId ?? null,
      fulfillmentStatus: snapshot.order.fulfillmentStatus ?? null,
      paymentStatusEntryId: snapshot.order.paymentStatusEntryId ?? null,
      paymentStatus: snapshot.order.paymentStatus ?? null,
      customerEntityId: snapshot.order.customerEntityId ?? null,
      customerContactId: snapshot.order.customerContactId ?? null,
      customerSnapshot: snapshot.order.customerSnapshot ? cloneJson(snapshot.order.customerSnapshot) : null,
      billingAddressId: snapshot.order.billingAddressId ?? null,
      shippingAddressId: snapshot.order.shippingAddressId ?? null,
      billingAddressSnapshot: snapshot.order.billingAddressSnapshot
        ? cloneJson(snapshot.order.billingAddressSnapshot)
        : null,
      shippingAddressSnapshot: snapshot.order.shippingAddressSnapshot
        ? cloneJson(snapshot.order.shippingAddressSnapshot)
        : null,
      currencyCode: snapshot.order.currencyCode,
      exchangeRate: snapshot.order.exchangeRate ?? null,
      taxStrategyKey: snapshot.order.taxStrategyKey ?? null,
      discountStrategyKey: snapshot.order.discountStrategyKey ?? null,
      taxInfo: snapshot.order.taxInfo ? cloneJson(snapshot.order.taxInfo) : null,
      shippingMethodId: snapshot.order.shippingMethodId ?? null,
      shippingMethodCode: snapshot.order.shippingMethodCode ?? null,
      deliveryWindowId: snapshot.order.deliveryWindowId ?? null,
      deliveryWindowCode: snapshot.order.deliveryWindowCode ?? null,
      paymentMethodId: snapshot.order.paymentMethodId ?? null,
      paymentMethodCode: snapshot.order.paymentMethodCode ?? null,
      channelId: snapshot.order.channelId ?? null,
      placedAt: snapshot.order.placedAt ? new Date(snapshot.order.placedAt) : null,
      expectedDeliveryAt: snapshot.order.expectedDeliveryAt ? new Date(snapshot.order.expectedDeliveryAt) : null,
      dueAt: snapshot.order.dueAt ? new Date(snapshot.order.dueAt) : null,
      comments: snapshot.order.comments ?? null,
      internalNotes: snapshot.order.internalNotes ?? null,
      shippingMethodSnapshot: snapshot.order.shippingMethodSnapshot
        ? cloneJson(snapshot.order.shippingMethodSnapshot)
        : null,
      deliveryWindowSnapshot: snapshot.order.deliveryWindowSnapshot
        ? cloneJson(snapshot.order.deliveryWindowSnapshot)
        : null,
      paymentMethodSnapshot: snapshot.order.paymentMethodSnapshot
        ? cloneJson(snapshot.order.paymentMethodSnapshot)
        : null,
      metadata: snapshot.order.metadata ? cloneJson(snapshot.order.metadata) : null,
      customFieldSetId: snapshot.order.customFieldSetId ?? null,
      subtotalNetAmount: snapshot.order.subtotalNetAmount,
      subtotalGrossAmount: snapshot.order.subtotalGrossAmount,
      discountTotalAmount: snapshot.order.discountTotalAmount,
      taxTotalAmount: snapshot.order.taxTotalAmount,
      shippingNetAmount: snapshot.order.shippingNetAmount,
      shippingGrossAmount: snapshot.order.shippingGrossAmount,
      surchargeTotalAmount: snapshot.order.surchargeTotalAmount,
      grandTotalNetAmount: snapshot.order.grandTotalNetAmount,
      grandTotalGrossAmount: snapshot.order.grandTotalGrossAmount,
      paidTotalAmount: snapshot.order.paidTotalAmount,
      refundedTotalAmount: snapshot.order.refundedTotalAmount,
      outstandingAmount: snapshot.order.outstandingAmount,
      lineItemCount: snapshot.order.lineItemCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(order)
  }
  applyOrderSnapshot(order, snapshot.order)
  await em.nativeDelete(SalesOrderLine, { order: order.id })
  await em.nativeDelete(SalesOrderAdjustment, { order: order.id })

  snapshot.lines.forEach((line) => {
    const lineEntity = em.create(SalesOrderLine, {
      id: line.id,
      order,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      lineNumber: line.lineNumber,
      kind: line.kind as SalesLineKind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      reservedQuantity: line.reservedQuantity,
      fulfilledQuantity: line.fulfilledQuantity,
      invoicedQuantity: line.invoicedQuantity,
      returnedQuantity: line.returnedQuantity,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
  })

  snapshot.adjustments.forEach((adjustment, index) => {
    const adjustmentEntity = em.create(SalesOrderAdjustment, {
      id: adjustment.id,
      order,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      scope: adjustment.scope,
      kind: adjustment.kind as SalesAdjustmentKind,
      code: adjustment.code ?? null,
      label: adjustment.label ?? null,
      calculatorKey: adjustment.calculatorKey ?? null,
      promotionId: adjustment.promotionId ?? null,
      rate: adjustment.rate,
      amountNet: adjustment.amountNet,
      amountGross: adjustment.amountGross,
      currencyCode: adjustment.currencyCode ?? null,
      metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
      position: adjustment.position ?? index,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    adjustmentEntity.orderLine = null
    em.persist(adjustmentEntity)
  })

  return order
}

const createQuoteCommand: CommandHandler<QuoteCreateInput, { quoteId: string }> = {
  id: 'sales.quotes.create',
  async execute(rawInput, ctx) {
    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const initial = quoteCreateSchema.parse(rawInput ?? {})
    const quoteNumber =
      typeof initial.quoteNumber === 'string' && initial.quoteNumber.trim().length
        ? initial.quoteNumber.trim()
        : (
            await generator.generate({
              kind: 'quote',
              organizationId: initial.organizationId,
              tenantId: initial.tenantId,
            })
          ).number
    const parsed = quoteCreateSchema.parse({ ...initial, quoteNumber })
    const ensuredQuoteNumber = parsed.quoteNumber ?? quoteNumber
    if (!ensuredQuoteNumber) {
      throw new CrudHttpError(400, { error: 'Quote number is required.' })
    }
    ensureQuoteScope(ctx, parsed.organizationId, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const {
      customerSnapshot: resolvedCustomerSnapshot,
      billingAddressSnapshot: resolvedBillingSnapshot,
      shippingAddressSnapshot: resolvedShippingSnapshot,
      shippingMethod,
      deliveryWindow,
      paymentMethod,
    } = await resolveDocumentReferences(em, parsed)
    const quoteStatus = await resolveDictionaryEntryValue(em, parsed.statusEntryId ?? null)
    const quote = em.create(SalesQuote, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      quoteNumber: ensuredQuoteNumber,
      statusEntryId: parsed.statusEntryId ?? null,
      status: quoteStatus,
      customerEntityId: parsed.customerEntityId ?? null,
      customerContactId: parsed.customerContactId ?? null,
      customerSnapshot: resolvedCustomerSnapshot ? cloneJson(resolvedCustomerSnapshot) : null,
      billingAddressId: parsed.billingAddressId ?? null,
      shippingAddressId: parsed.shippingAddressId ?? null,
      billingAddressSnapshot: resolvedBillingSnapshot ? cloneJson(resolvedBillingSnapshot) : null,
      shippingAddressSnapshot: resolvedShippingSnapshot ? cloneJson(resolvedShippingSnapshot) : null,
      currencyCode: parsed.currencyCode,
      validFrom: parsed.validFrom ?? null,
      validUntil: parsed.validUntil ?? null,
      comments: parsed.comments ?? null,
      taxInfo: parsed.taxInfo ? cloneJson(parsed.taxInfo) : null,
      shippingMethodId: parsed.shippingMethodId ?? null,
      shippingMethod: shippingMethod ?? null,
      shippingMethodCode: parsed.shippingMethodCode ?? shippingMethod?.code ?? null,
      deliveryWindowId: parsed.deliveryWindowId ?? null,
      deliveryWindow: deliveryWindow ?? null,
      deliveryWindowCode: parsed.deliveryWindowCode ?? deliveryWindow?.code ?? null,
      paymentMethodId: parsed.paymentMethodId ?? null,
      paymentMethod: paymentMethod ?? null,
      paymentMethodCode: parsed.paymentMethodCode ?? paymentMethod?.code ?? null,
      shippingMethodSnapshot: parsed.shippingMethodSnapshot
        ? cloneJson(parsed.shippingMethodSnapshot)
        : shippingMethod
          ? {
              id: shippingMethod.id,
              code: shippingMethod.code,
              name: shippingMethod.name,
              description: shippingMethod.description ?? null,
              carrierCode: shippingMethod.carrierCode ?? null,
              serviceLevel: shippingMethod.serviceLevel ?? null,
              estimatedTransitDays: shippingMethod.estimatedTransitDays ?? null,
              currencyCode: shippingMethod.currencyCode ?? null,
            }
          : null,
      deliveryWindowSnapshot: parsed.deliveryWindowSnapshot
        ? cloneJson(parsed.deliveryWindowSnapshot)
        : deliveryWindow
          ? {
              id: deliveryWindow.id,
              code: deliveryWindow.code,
              name: deliveryWindow.name,
              description: deliveryWindow.description ?? null,
              leadTimeDays: deliveryWindow.leadTimeDays ?? null,
              cutoffTime: deliveryWindow.cutoffTime ?? null,
              timezone: deliveryWindow.timezone ?? null,
            }
          : null,
      paymentMethodSnapshot: parsed.paymentMethodSnapshot
        ? cloneJson(parsed.paymentMethodSnapshot)
        : paymentMethod
          ? {
              id: paymentMethod.id,
              code: paymentMethod.code,
              name: paymentMethod.name,
              description: paymentMethod.description ?? null,
              providerKey: paymentMethod.providerKey ?? null,
              terms: paymentMethod.terms ?? null,
          }
        : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      channelId: parsed.channelId ?? null,
      customFieldSetId: parsed.customFieldSetId ?? null,
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      lineItemCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(quote)

    const lineInputs = (parsed.lines ?? []).map((line, index) =>
      quoteLineCreateSchema.parse({
        ...line,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        quoteId: quote.id,
        lineNumber: line.lineNumber ?? index + 1,
      })
    )
    const adjustmentInputs = parsed.adjustments
      ? parsed.adjustments.map((adj) =>
          quoteAdjustmentCreateSchema.parse({
            ...adj,
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            quoteId: quote.id,
          })
        )
      : null

    const lineSnapshots: SalesLineSnapshot[] = lineInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts: SalesAdjustmentDraft[] = adjustmentInputs
      ? adjustmentInputs.map((adj) => createAdjustmentDraftFromInput(adj))
      : []

    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: {
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
        currencyCode: quote.currencyCode,
      },
    })

    await replaceQuoteLines(em, quote, calculation, lineInputs)
    await replaceQuoteAdjustments(em, quote, calculation, adjustmentInputs)
    applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
    await syncSalesDocumentTags(em, {
      documentId: quote.id,
      kind: 'quote',
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      tagIds: parsed.tags,
    })
    await em.flush()

    return { quoteId: quote.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadQuoteSnapshot(em, result.quoteId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.create', 'Create sales quote'),
      resourceKind: 'sales.quote',
      resourceId: result.quoteId,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: after.quote.id })
    if (!quote) return
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
    await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
    em.remove(quote)
    await em.flush()
  },
}

const deleteQuoteCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { quoteId: string }
> = {
  id: 'sales.quotes.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Quote id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadQuoteSnapshot(em, id)
    if (snapshot) {
      ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Quote id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    await em.nativeDelete(SalesDocumentTagAssignment, { documentId: quote.id, documentKind: 'quote' })
    await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
    await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
    em.remove(quote)
    await em.flush()
    return { quoteId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.delete', 'Delete sales quote'),
      resourceKind: 'sales.quote',
      resourceId: before.quote.id,
      tenantId: before.quote.tenantId,
      organizationId: before.quote.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

const createOrderCommand: CommandHandler<OrderCreateInput, { orderId: string }> = {
  id: 'sales.orders.create',
  async execute(rawInput, ctx) {
    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const initial = orderCreateSchema.parse(rawInput ?? {})
    const orderNumber =
      typeof initial.orderNumber === 'string' && initial.orderNumber.trim().length
        ? initial.orderNumber.trim()
        : (
            await generator.generate({
              kind: 'order',
              organizationId: initial.organizationId,
              tenantId: initial.tenantId,
            })
          ).number
    const parsed = orderCreateSchema.parse({ ...initial, orderNumber })
    const ensuredOrderNumber = parsed.orderNumber ?? orderNumber
    if (!ensuredOrderNumber) {
      throw new CrudHttpError(400, { error: 'Order number is required.' })
    }
    ensureOrderScope(ctx, parsed.organizationId, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const [status, fulfillmentStatus, paymentStatus] = await Promise.all([
      resolveDictionaryEntryValue(em, parsed.statusEntryId ?? null),
      resolveDictionaryEntryValue(em, parsed.fulfillmentStatusEntryId ?? null),
      resolveDictionaryEntryValue(em, parsed.paymentStatusEntryId ?? null),
    ])
    const {
      customerSnapshot: resolvedCustomerSnapshot,
      billingAddressSnapshot: resolvedBillingSnapshot,
      shippingAddressSnapshot: resolvedShippingSnapshot,
      shippingMethod,
      deliveryWindow,
      paymentMethod,
    } = await resolveDocumentReferences(em, parsed)

    const order = em.create(SalesOrder, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      orderNumber: ensuredOrderNumber,
      statusEntryId: parsed.statusEntryId ?? null,
      status,
      fulfillmentStatusEntryId: parsed.fulfillmentStatusEntryId ?? null,
      fulfillmentStatus,
      paymentStatusEntryId: parsed.paymentStatusEntryId ?? null,
      paymentStatus,
      customerEntityId: parsed.customerEntityId ?? null,
      customerContactId: parsed.customerContactId ?? null,
      customerSnapshot: resolvedCustomerSnapshot ? cloneJson(resolvedCustomerSnapshot) : null,
      billingAddressId: parsed.billingAddressId ?? null,
      shippingAddressId: parsed.shippingAddressId ?? null,
      billingAddressSnapshot: resolvedBillingSnapshot ? cloneJson(resolvedBillingSnapshot) : null,
      shippingAddressSnapshot: resolvedShippingSnapshot ? cloneJson(resolvedShippingSnapshot) : null,
      currencyCode: parsed.currencyCode,
      exchangeRate:
        typeof parsed.exchangeRate === 'number' ? toNumericString(parsed.exchangeRate) : null,
      taxStrategyKey: parsed.taxStrategyKey ?? null,
      discountStrategyKey: parsed.discountStrategyKey ?? null,
      taxInfo: parsed.taxInfo ? cloneJson(parsed.taxInfo) : null,
      shippingMethodId: parsed.shippingMethodId ?? null,
      shippingMethod: shippingMethod ?? null,
      shippingMethodCode: parsed.shippingMethodCode ?? shippingMethod?.code ?? null,
      deliveryWindowId: parsed.deliveryWindowId ?? null,
      deliveryWindow: deliveryWindow ?? null,
      deliveryWindowCode: parsed.deliveryWindowCode ?? deliveryWindow?.code ?? null,
      paymentMethodId: parsed.paymentMethodId ?? null,
      paymentMethod: paymentMethod ?? null,
      paymentMethodCode: parsed.paymentMethodCode ?? paymentMethod?.code ?? null,
      channelId: parsed.channelId ?? null,
      placedAt: parsed.placedAt ?? null,
      expectedDeliveryAt: parsed.expectedDeliveryAt ?? null,
      dueAt: parsed.dueAt ?? null,
      comments: parsed.comments ?? null,
      internalNotes: parsed.internalNotes ?? null,
      shippingMethodSnapshot: parsed.shippingMethodSnapshot
        ? cloneJson(parsed.shippingMethodSnapshot)
        : shippingMethod
          ? {
              id: shippingMethod.id,
              code: shippingMethod.code,
              name: shippingMethod.name,
              description: shippingMethod.description ?? null,
              carrierCode: shippingMethod.carrierCode ?? null,
              serviceLevel: shippingMethod.serviceLevel ?? null,
              estimatedTransitDays: shippingMethod.estimatedTransitDays ?? null,
              currencyCode: shippingMethod.currencyCode ?? null,
            }
          : null,
      deliveryWindowSnapshot: parsed.deliveryWindowSnapshot
        ? cloneJson(parsed.deliveryWindowSnapshot)
        : deliveryWindow
          ? {
              id: deliveryWindow.id,
              code: deliveryWindow.code,
              name: deliveryWindow.name,
              description: deliveryWindow.description ?? null,
              leadTimeDays: deliveryWindow.leadTimeDays ?? null,
              cutoffTime: deliveryWindow.cutoffTime ?? null,
              timezone: deliveryWindow.timezone ?? null,
            }
          : null,
      paymentMethodSnapshot: parsed.paymentMethodSnapshot
        ? cloneJson(parsed.paymentMethodSnapshot)
        : paymentMethod
          ? {
              id: paymentMethod.id,
              code: paymentMethod.code,
              name: paymentMethod.name,
              description: paymentMethod.description ?? null,
              providerKey: paymentMethod.providerKey ?? null,
              terms: paymentMethod.terms ?? null,
            }
          : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      customFieldSetId: parsed.customFieldSetId ?? null,
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      shippingNetAmount: '0',
      shippingGrossAmount: '0',
      surchargeTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      paidTotalAmount: '0',
      refundedTotalAmount: '0',
      outstandingAmount: '0',
      lineItemCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(order)

    const lineInputs = (parsed.lines ?? []).map((line, index) =>
      orderLineCreateSchema.parse({
        ...line,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        orderId: order.id,
        lineNumber: line.lineNumber ?? index + 1,
      })
    )
    const adjustmentInputs = parsed.adjustments
      ? parsed.adjustments.map((adj) =>
          orderAdjustmentCreateSchema.parse({
            ...adj,
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            orderId: order.id,
          })
        )
      : null

    const lineSnapshots: SalesLineSnapshot[] = lineInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts: SalesAdjustmentDraft[] = adjustmentInputs
      ? adjustmentInputs.map((adj) => createAdjustmentDraftFromInput(adj))
      : []

    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: {
        tenantId: order.tenantId,
        organizationId: order.organizationId,
        currencyCode: order.currencyCode,
      },
    })

    await replaceOrderLines(em, order, calculation, lineInputs)
    await replaceOrderAdjustments(em, order, calculation, adjustmentInputs)
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    await syncSalesDocumentTags(em, {
      documentId: order.id,
      kind: 'order',
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      tagIds: parsed.tags,
    })
    await em.flush()

    return { orderId: order.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.create', 'Create sales order'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: after.order.id })
    if (!order) return
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    await em.nativeDelete(SalesOrderAdjustment, { order: order.id })
    await em.nativeDelete(SalesOrderLine, { order: order.id })
    em.remove(order)
    await em.flush()
  },
}

const deleteOrderCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string }
> = {
  id: 'sales.orders.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Order id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOrderSnapshot(em, id)
    if (snapshot) {
      ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Order id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    await em.nativeDelete(SalesDocumentTagAssignment, { documentId: order.id, documentKind: 'order' })
    await em.nativeDelete(SalesOrderAdjustment, { order: order.id })
    await em.nativeDelete(SalesOrderLine, { order: order.id })
    em.remove(order)
    await em.flush()
    return { orderId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OrderGraphSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.delete', 'Delete sales order'),
      resourceKind: 'sales.order',
      resourceId: before.order.id,
      tenantId: before.order.tenantId,
      organizationId: before.order.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

registerCommand(createQuoteCommand)
registerCommand(deleteQuoteCommand)
registerCommand(createOrderCommand)
registerCommand(deleteOrderCommand)
