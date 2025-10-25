import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
} from '../data/entities'
import {
  quoteCreateSchema,
  quoteUpdateSchema,
  quoteLineCreateSchema,
  quoteAdjustmentCreateSchema,
  type QuoteCreateInput,
  type QuoteUpdateInput,
  type QuoteLineCreateInput,
  type QuoteAdjustmentCreateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  toNumericString,
} from './shared'
import {
  calculateDocumentTotals,
  type SalesLineSnapshot,
  type SalesAdjustmentDraft,
  type SalesLineCalculationResult,
  type SalesDocumentCalculationResult,
} from '../lib/calculations'

type QuoteGraphSnapshot = {
  quote: {
    id: string
    organizationId: string
    tenantId: string
    quoteNumber: string
    statusEntryId: string | null
    customerEntityId: string | null
    customerContactId: string | null
    currencyCode: string
    validFrom: string | null
    validUntil: string | null
    comments: string | null
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
      customerEntityId: quote.customerEntityId ?? null,
      customerContactId: quote.customerContactId ?? null,
      currencyCode: quote.currencyCode,
      validFrom: quote.validFrom ? quote.validFrom.toISOString() : null,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      comments: quote.comments ?? null,
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

function mapExistingQuoteLineToInput(line: SalesQuoteLine): QuoteLineCreateInput {
  return {
    quoteId: line.quote instanceof SalesQuote ? line.quote.id : (line.quote as string),
    organizationId: line.organizationId,
    tenantId: line.tenantId,
    lineNumber: line.lineNumber,
    kind: line.kind,
    statusEntryId: line.statusEntryId ?? undefined,
    productId: line.productId ?? undefined,
    productVariantId: line.productVariantId ?? undefined,
    catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : undefined,
    name: line.name ?? undefined,
    description: line.description ?? undefined,
    comment: line.comment ?? undefined,
    quantity: Number(line.quantity),
    quantityUnit: line.quantityUnit ?? undefined,
    currencyCode: line.currencyCode,
    unitPriceNet: Number(line.unitPriceNet),
    unitPriceGross: Number(line.unitPriceGross),
    discountAmount: Number(line.discountAmount),
    discountPercent: Number(line.discountPercent),
    taxRate: Number(line.taxRate),
    taxAmount: Number(line.taxAmount),
    totalNetAmount: Number(line.totalNetAmount),
    totalGrossAmount: Number(line.totalGrossAmount),
    configuration: line.configuration ? cloneJson(line.configuration) : undefined,
    promotionCode: line.promotionCode ?? undefined,
    promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : undefined,
    metadata: line.metadata ? cloneJson(line.metadata) : undefined,
    customFieldSetId: line.customFieldSetId ?? undefined,
  }
}

function mapExistingQuoteAdjustmentToInput(
  adjustment: SalesQuoteAdjustment
): QuoteAdjustmentCreateInput {
  return {
    quoteId: adjustment.quote instanceof SalesQuote ? adjustment.quote.id : (adjustment.quote as string),
    organizationId: adjustment.organizationId,
    tenantId: adjustment.tenantId,
    quoteLineId:
      typeof adjustment.quoteLine === 'string'
        ? adjustment.quoteLine
        : adjustment.quoteLine?.id ?? undefined,
    scope: adjustment.scope,
    kind: adjustment.kind,
    code: adjustment.code ?? undefined,
    label: adjustment.label ?? undefined,
    calculatorKey: adjustment.calculatorKey ?? undefined,
    promotionId: adjustment.promotionId ?? undefined,
    rate: Number(adjustment.rate),
    amountNet: Number(adjustment.amountNet),
    amountGross: Number(adjustment.amountGross),
    currencyCode: adjustment.currencyCode ?? undefined,
    metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : undefined,
    position: adjustment.position,
  }
}

async function replaceQuoteLines(
  em: EntityManager,
  quote: SalesQuote,
  calculation: SalesDocumentCalculationResult,
  lineInputs: QuoteLineCreateInput[]
): Promise<void> {
  await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
  calculation.lines.forEach((lineResult, index) => {
    const sourceLine = lineInputs[index]
    const entityInput = convertLineCalculationToEntityInput(lineResult, sourceLine, quote, index)
    const lineEntity = em.create(SalesQuoteLine, {
      quote,
      ...entityInput,
    })
    em.persist(lineEntity)
  })
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
  quote.customerEntityId = snapshot.customerEntityId ?? null
  quote.customerContactId = snapshot.customerContactId ?? null
  quote.currencyCode = snapshot.currencyCode
  quote.validFrom = snapshot.validFrom ? new Date(snapshot.validFrom) : null
  quote.validUntil = snapshot.validUntil ? new Date(snapshot.validUntil) : null
  quote.comments = snapshot.comments ?? null
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
      kind: line.kind,
      statusEntryId: line.statusEntryId ?? null,
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
      kind: adjustment.kind,
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const quote = em.create(SalesQuote, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      quoteNumber: parsed.quoteNumber,
      statusEntryId: parsed.statusEntryId ?? null,
      customerEntityId: parsed.customerEntityId ?? null,
      customerContactId: parsed.customerContactId ?? null,
      currencyCode: parsed.currencyCode,
      validFrom: parsed.validFrom ?? null,
      validUntil: parsed.validUntil ?? null,
      comments: parsed.comments ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      customFieldSetId: parsed.customFieldSetId ?? null,
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      lineItemCount: 0,
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

    const calculation = await calculateDocumentTotals({
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
    const em = ctx.container.resolve<EntityManager>('em')
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const quote = await em.findOne(SalesQuote, { id: after.quote.id })
    if (!quote) return
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
    await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
    em.remove(quote)
    await em.flush()
  },
}

registerCommand(createQuoteCommand)
