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
  SalesShippingMethod,
  SalesDeliveryWindow,
  SalesPaymentMethod,
  type SalesLineKind,
  type SalesAdjustmentKind,
} from '../data/entities'
import {
  CustomerAddress,
  CustomerEntity,
  CustomerPersonProfile,
} from '../customers/data/entities'
import {
  quoteCreateSchema,
  quoteLineCreateSchema,
  quoteAdjustmentCreateSchema,
  type QuoteCreateInput,
  type QuoteLineCreateInput,
  type QuoteAdjustmentCreateInput,
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

type QuoteUndoPayload = {
  before?: QuoteGraphSnapshot | null
  after?: QuoteGraphSnapshot | null
}

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

function createLineSnapshotFromInput(
  line: QuoteLineCreateInput,
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
  adjustment: QuoteAdjustmentCreateInput
): SalesAdjustmentDraft {
  if (adjustment.scope === 'line' && adjustment.quoteLineId) {
    throw new CrudHttpError(400, { error: 'Line-scoped quote adjustments are not supported yet.' })
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
  sourceLine: QuoteLineCreateInput,
  quote: SalesQuote,
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
    organizationId: quote.organizationId,
    tenantId: quote.tenantId,
  }
}

function convertAdjustmentResultToEntityInput(
  adjustment: SalesAdjustmentDraft,
  sourceAdjustment: QuoteAdjustmentCreateInput | null,
  quote: SalesQuote,
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
    organizationId: quote.organizationId,
    tenantId: quote.tenantId,
    quoteLineId: null,
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

function ensureQuoteScope(ctx: Parameters<typeof ensureTenantScope>[0], organizationId: string, tenantId: string): void {
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
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
  quote.customFieldSetId = snapshot.customFieldSetId ?? null
  quote.subtotalNetAmount = snapshot.subtotalNetAmount
  quote.subtotalGrossAmount = snapshot.subtotalGrossAmount
  quote.discountTotalAmount = snapshot.discountTotalAmount
  quote.taxTotalAmount = snapshot.taxTotalAmount
  quote.grandTotalNetAmount = snapshot.grandTotalNetAmount
  quote.grandTotalGrossAmount = snapshot.grandTotalGrossAmount
  quote.lineItemCount = snapshot.lineItemCount
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

const createQuoteCommand: CommandHandler<QuoteCreateInput, { quoteId: string }> = {
  id: 'sales.quotes.create',
  async execute(rawInput, ctx) {
    const parsed = quoteCreateSchema.parse(rawInput)
    ensureQuoteScope(ctx, parsed.organizationId, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
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
    const quoteStatus = await resolveDictionaryEntryValue(em, parsed.statusEntryId ?? null)
    const quote = em.create(SalesQuote, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      quoteNumber: parsed.quoteNumber,
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

registerCommand(createQuoteCommand)
registerCommand(deleteQuoteCommand)
