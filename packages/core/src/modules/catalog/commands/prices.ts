import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogOffer, CatalogProduct, CatalogProductPrice, CatalogProductVariant, CatalogPriceKind } from '../data/entities'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '#generated/entities.ids.generated'
import {
  priceCreateSchema,
  priceUpdateSchema,
  type PriceCreateInput,
  type PriceUpdateInput,
} from '../data/validators'
import type { TaxCalculationService } from '@open-mercato/core/modules/sales/services/taxCalculationService'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureSameTenant,
  ensureTenantScope,
  extractUndoPayload,
  requireVariant,
  requireProduct,
  requireOffer,
  requirePriceKind,
  toNumericString,
} from './shared'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

type PriceSnapshot = {
  id: string
  variantId: string | null
  productId: string | null
  offerId: string | null
  organizationId: string
  tenantId: string
  currencyCode: string
  priceKindId: string
  priceKindCode: string
  kind: string
  minQuantity: number
  maxQuantity: number | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  taxAmount: string | null
  channelId: string | null
  userId: string | null
  userGroupId: string | null
  customerId: string | null
  customerGroupId: string | null
  metadata: Record<string, unknown> | null
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

type PriceUndoPayload = {
  before?: PriceSnapshot | null
  after?: PriceSnapshot | null
}

const PRICE_CHANGE_KEYS = [
  'currencyCode',
  'priceKindId',
  'kind',
  'minQuantity',
  'maxQuantity',
  'unitPriceNet',
  'unitPriceGross',
  'taxRate',
  'taxAmount',
  'channelId',
  'userId',
  'userGroupId',
  'customerId',
  'customerGroupId',
  'metadata',
  'startsAt',
  'endsAt',
] as const satisfies readonly string[]

async function resolveSnapshotAssociations(
  em: EntityManager,
  snapshot: PriceSnapshot
): Promise<{
  variant: CatalogProductVariant | null
  product: CatalogProduct
  offer: CatalogOffer | null
}> {
  let variant: CatalogProductVariant | null = null
  if (snapshot.variantId) {
    variant = await requireVariant(em, snapshot.variantId)
  }
  let product: CatalogProduct | null = null
  if (snapshot.productId) {
    product = await requireProduct(em, snapshot.productId)
  } else if (variant) {
    product =
      typeof variant.product === 'string'
        ? await requireProduct(em, variant.product)
        : variant.product
  }
  if (!product) {
    throw new CrudHttpError(400, { error: 'Price snapshot missing product association.' })
  }
  let offer: CatalogOffer | null = null
  if (snapshot.offerId) {
    offer = await requireOffer(em, snapshot.offerId)
  }
  return { variant, product, offer }
}

async function loadPriceSnapshot(em: EntityManager, id: string): Promise<PriceSnapshot | null> {
  const record = await findOneWithDecryption(
    em,
    CatalogProductPrice,
    { id },
    { populate: ['priceKind', 'product', 'variant', 'offer'] },
  )
  if (!record) return null
  const variantId =
    typeof record.variant === 'string'
      ? record.variant
      : record.variant
        ? record.variant.id
        : null
  const productRef = record.product
    ? record.product
    : typeof record.variant === 'object' && record.variant
      ? record.variant.product
      : null
  const productId =
    typeof productRef === 'string'
      ? productRef
      : productRef
        ? productRef.id
        : null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product_price,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  const priceKind = record.priceKind
  const priceKindId =
    typeof priceKind === 'string'
      ? priceKind
      : priceKind
        ? priceKind.id
        : null
  if (!priceKindId) {
    throw new CrudHttpError(400, { error: 'Price is missing price kind metadata.' })
  }
  const priceKindCode =
    typeof priceKind === 'object' && priceKind ? priceKind.code : record.kind
  return {
    id: record.id,
    variantId,
    productId,
    offerId: typeof record.offer === 'string' ? record.offer : record.offer ? record.offer.id : null,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    currencyCode: record.currencyCode,
    priceKindId,
    priceKindCode,
    kind: record.kind,
    minQuantity: record.minQuantity,
    maxQuantity: record.maxQuantity ?? null,
    unitPriceNet: record.unitPriceNet ?? null,
    unitPriceGross: record.unitPriceGross ?? null,
    taxRate: record.taxRate ?? null,
    taxAmount: record.taxAmount ?? null,
    channelId: record.channelId ?? null,
    userId: record.userId ?? null,
    userGroupId: record.userGroupId ?? null,
    customerId: record.customerId ?? null,
    customerGroupId: record.customerGroupId ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    startsAt: record.startsAt ? record.startsAt.toISOString() : null,
    endsAt: record.endsAt ? record.endsAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
  }
}

function applyPriceSnapshot(em: EntityManager, record: CatalogProductPrice, snapshot: PriceSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.currencyCode = snapshot.currencyCode
  record.priceKind = em.getReference(CatalogPriceKind, snapshot.priceKindId)
  record.kind = snapshot.priceKindCode || snapshot.kind
  record.minQuantity = snapshot.minQuantity
  record.maxQuantity = snapshot.maxQuantity ?? null
  record.unitPriceNet = snapshot.unitPriceNet ?? null
  record.unitPriceGross = snapshot.unitPriceGross ?? null
  record.taxRate = snapshot.taxRate ?? null
  record.taxAmount = snapshot.taxAmount ?? null
  record.channelId = snapshot.channelId ?? null
  record.userId = snapshot.userId ?? null
  record.userGroupId = snapshot.userGroupId ?? null
  record.customerId = snapshot.customerId ?? null
  record.customerGroupId = snapshot.customerGroupId ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.startsAt = snapshot.startsAt ? new Date(snapshot.startsAt) : null
  record.endsAt = snapshot.endsAt ? new Date(snapshot.endsAt) : null
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

type PriceAmountInput = {
  amount: number
  mode: 'net' | 'gross'
}

function resolveAmountInputFromParsed(
  parsed: Partial<Pick<PriceCreateInput, 'unitPriceNet' | 'unitPriceGross'>>
): PriceAmountInput | null {
  if (typeof parsed.unitPriceNet === 'number' && Number.isFinite(parsed.unitPriceNet)) {
    return { amount: parsed.unitPriceNet, mode: 'net' }
  }
  if (typeof parsed.unitPriceGross === 'number' && Number.isFinite(parsed.unitPriceGross)) {
    return { amount: parsed.unitPriceGross, mode: 'gross' }
  }
  return null
}

function resolveAmountInputFromRecord(record: CatalogProductPrice): PriceAmountInput | null {
  const net = numericStringToNumber(record.unitPriceNet)
  if (net !== null) return { amount: net, mode: 'net' }
  const gross = numericStringToNumber(record.unitPriceGross)
  if (gross !== null) return { amount: gross, mode: 'gross' }
  return null
}

function numericStringToNumber(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const createPriceCommand: CommandHandler<PriceCreateInput, { priceId: string }> = {
  id: 'catalog.prices.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(priceCreateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let variant: CatalogProductVariant | null = null
    let product: CatalogProduct | null = null
    if (parsed.variantId) {
      variant = await requireVariant(em, parsed.variantId)
      product =
        typeof variant.product === 'string'
          ? await requireProduct(em, variant.product)
          : variant.product
    }
    if (parsed.productId) {
      const explicitProduct = await requireProduct(em, parsed.productId)
      if (product && explicitProduct.id !== product.id) {
        throw new CrudHttpError(400, { error: 'Variant does not belong to the provided product.' })
      }
      product = explicitProduct
    }
    if (!variant && !product) {
      throw new CrudHttpError(400, { error: 'Provide either a variantId or productId for pricing.' })
    }
    const scopeSource = variant ?? product!
    ensureTenantScope(ctx, scopeSource.tenantId)
    ensureOrganizationScope(ctx, scopeSource.organizationId)

    const priceKind = await requirePriceKind(em, parsed.priceKindId)
    ensureSameTenant(priceKind, scopeSource.tenantId)

    let offer: CatalogOffer | null = null
    if (parsed.offerId) {
      offer = await requireOffer(em, parsed.offerId)
      ensureSameScope(offer, scopeSource.organizationId, scopeSource.tenantId)
      const offerProduct =
        typeof offer.product === 'string'
          ? await requireProduct(em, offer.product)
          : offer.product
      if (product && offerProduct.id !== product.id) {
        throw new CrudHttpError(400, { error: 'Offer does not belong to the selected product.' })
      }
      product = offerProduct
    }
    const productEntity = product
    const channelId = parsed.channelId ?? (offer ? offer.channelId : null)
    const taxCalculationService = ctx.container.resolve<TaxCalculationService>('taxCalculationService')
    const amountInput = resolveAmountInputFromParsed(parsed)
    let unitPriceNetValue = toNumericString(parsed.unitPriceNet)
    let unitPriceGrossValue = toNumericString(parsed.unitPriceGross)
    let taxRateValue = toNumericString(parsed.taxRate)
    let taxAmountValue: string | null = null
    if (amountInput) {
      const calculation = await taxCalculationService.calculateUnitAmounts({
        amount: amountInput.amount,
        mode: amountInput.mode,
        organizationId: scopeSource.organizationId,
        tenantId: scopeSource.tenantId,
        taxRateId: parsed.taxRateId ?? null,
        taxRate: parsed.taxRate ?? null,
      })
      unitPriceNetValue = toNumericString(calculation.netAmount)
      unitPriceGrossValue = toNumericString(calculation.grossAmount)
      taxAmountValue = toNumericString(calculation.taxAmount)
      taxRateValue = toNumericString(calculation.taxRate)
    }

    const now = new Date()
    const record = em.create(CatalogProductPrice, {
      organizationId: scopeSource.organizationId,
      tenantId: scopeSource.tenantId,
      variant,
      product: productEntity ?? undefined,
      offer: offer ?? undefined,
      priceKind,
      currencyCode: parsed.currencyCode,
      kind: priceKind.code,
      minQuantity: parsed.minQuantity ?? 1,
      maxQuantity: parsed.maxQuantity ?? null,
      unitPriceNet: unitPriceNetValue,
      unitPriceGross: unitPriceGrossValue,
      taxRate: taxRateValue,
      taxAmount: taxAmountValue,
      channelId,
      userId: parsed.userId ?? null,
      userGroupId: parsed.userGroupId ?? null,
      customerId: parsed.customerId ?? null,
      customerGroupId: parsed.customerGroupId ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      startsAt: parsed.startsAt ?? null,
      endsAt: parsed.endsAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_price,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { priceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadPriceSnapshot(em, result.priceId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as PriceSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.prices.create', 'Create product price'),
      resourceKind: 'catalog.price',
      resourceId: result.priceId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductPrice, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updatePriceCommand: CommandHandler<PriceUpdateInput, { priceId: string }> = {
  id: 'catalog.prices.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadPriceSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(priceUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      CatalogProductPrice,
      { id: parsed.id },
      { populate: ['priceKind'] },
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Catalog price not found' })
    const currentVariantRef = record.variant
    let targetVariant: CatalogProductVariant | null = null
    if (typeof currentVariantRef === 'string') {
      targetVariant = await requireVariant(em, currentVariantRef)
    } else if (currentVariantRef) {
      targetVariant = currentVariantRef
    }
    const currentProductRef = record.product ?? (targetVariant ? targetVariant.product : null)
    let targetProduct: CatalogProduct | null = null
    if (typeof currentProductRef === 'string') {
      targetProduct = await requireProduct(em, currentProductRef)
    } else if (currentProductRef) {
      targetProduct = currentProductRef
    }

    if (parsed.variantId !== undefined) {
      if (!parsed.variantId) {
        targetVariant = null
      } else {
        targetVariant = await requireVariant(em, parsed.variantId)
        targetProduct =
          typeof targetVariant.product === 'string'
            ? await requireProduct(em, targetVariant.product)
            : targetVariant.product
      }
    }

    if (targetVariant && (targetVariant as CatalogProductVariant | null)?.product === undefined) {
      targetVariant = await requireVariant(em, targetVariant.id)
    }

    if (parsed.productId !== undefined) {
      if (!parsed.productId) {
        targetProduct = null
      } else {
        const explicitProduct = await requireProduct(em, parsed.productId)
        if (targetVariant) {
          const variantProductId =
            typeof targetVariant.product === 'string'
              ? targetVariant.product
              : targetVariant.product.id
          if (variantProductId !== explicitProduct.id) {
            throw new CrudHttpError(400, { error: 'Variant does not belong to the provided product.' })
          }
        }
        targetProduct = explicitProduct
      }
    }

    if (!targetVariant && !targetProduct) {
      throw new CrudHttpError(400, { error: 'Price must remain associated with a product or variant.' })
    }
    if (!targetProduct && targetVariant) {
      targetProduct =
        typeof targetVariant.product === 'string'
          ? await requireProduct(em, targetVariant.product)
          : targetVariant.product
    }
    if (!targetProduct) {
      throw new CrudHttpError(400, { error: 'Unable to resolve product for price.' })
    }

    let targetOffer: CatalogOffer | null = null
    if (record.offer) {
      targetOffer =
        typeof record.offer === 'string'
          ? await requireOffer(em, record.offer)
          : record.offer
    }
    if (parsed.offerId !== undefined) {
      if (!parsed.offerId) {
        targetOffer = null
      } else {
        const explicitOffer = await requireOffer(em, parsed.offerId)
        ensureSameScope(explicitOffer, targetProduct.organizationId, targetProduct.tenantId)
        const offerProductId =
          typeof explicitOffer.product === 'string'
            ? explicitOffer.product
            : explicitOffer.product.id
        if (offerProductId !== targetProduct.id) {
          throw new CrudHttpError(400, { error: 'Offer does not belong to the selected product.' })
        }
        targetOffer = explicitOffer
      }
    }

    ensureTenantScope(ctx, targetProduct.tenantId)
    ensureOrganizationScope(ctx, targetProduct.organizationId)

    let targetPriceKind: CatalogPriceKind | null = null
    if (record.priceKind) {
      targetPriceKind =
        typeof record.priceKind === 'string'
          ? await requirePriceKind(em, record.priceKind)
          : record.priceKind
    }
    if (parsed.priceKindId !== undefined) {
      if (!parsed.priceKindId) {
        throw new CrudHttpError(400, { error: 'Price kind is required.' })
      }
      targetPriceKind = await requirePriceKind(em, parsed.priceKindId)
    }
    if (!targetPriceKind) {
      throw new CrudHttpError(400, { error: 'Price kind is required.' })
    }
    ensureSameTenant(targetPriceKind, targetProduct.tenantId)

    const taxCalculationService = ctx.container.resolve<TaxCalculationService>('taxCalculationService')
    const amountInput = resolveAmountInputFromParsed(parsed)
    const hasNetInput = Object.prototype.hasOwnProperty.call(parsed, 'unitPriceNet')
    const hasGrossInput = Object.prototype.hasOwnProperty.call(parsed, 'unitPriceGross')
    const hasTaxRateInput = Object.prototype.hasOwnProperty.call(parsed, 'taxRate')
    const hasTaxRateIdInput = Object.prototype.hasOwnProperty.call(parsed, 'taxRateId')
    let taxCalculationResult: Awaited<ReturnType<TaxCalculationService['calculateUnitAmounts']>> | null = null
    let calculationBase = amountInput
    if (!calculationBase && (hasTaxRateInput || hasTaxRateIdInput)) {
      calculationBase = resolveAmountInputFromRecord(record)
    }
    if (calculationBase) {
      const taxRateIdForCalculation = hasTaxRateIdInput ? parsed.taxRateId ?? null : undefined
      const taxRateForCalculation = hasTaxRateInput
        ? parsed.taxRate ?? null
        : taxRateIdForCalculation === null
          ? null
          : record.taxRate ?? null
      taxCalculationResult = await taxCalculationService.calculateUnitAmounts({
        amount: calculationBase.amount,
        mode: calculationBase.mode,
        organizationId: targetProduct.organizationId,
        tenantId: targetProduct.tenantId,
        taxRateId: taxRateIdForCalculation,
        taxRate: taxRateForCalculation,
      })
    }

    record.variant = targetVariant
    record.product = targetProduct
    record.offer = targetOffer
    record.organizationId = targetProduct.organizationId
    record.tenantId = targetProduct.tenantId
    record.priceKind = targetPriceKind
    record.kind = targetPriceKind.code

    if (parsed.currencyCode !== undefined) record.currencyCode = parsed.currencyCode
    if (parsed.minQuantity !== undefined) record.minQuantity = parsed.minQuantity ?? 1
    if (parsed.maxQuantity !== undefined) record.maxQuantity = parsed.maxQuantity ?? null
    if (taxCalculationResult) {
      record.unitPriceNet = toNumericString(taxCalculationResult.netAmount)
      record.unitPriceGross = toNumericString(taxCalculationResult.grossAmount)
      record.taxRate = toNumericString(taxCalculationResult.taxRate)
      record.taxAmount = toNumericString(taxCalculationResult.taxAmount)
    } else {
      if (hasNetInput) {
        record.unitPriceNet = toNumericString(parsed.unitPriceNet)
      }
      if (hasGrossInput) {
        record.unitPriceGross = toNumericString(parsed.unitPriceGross)
      }
      if (hasTaxRateInput) {
        record.taxRate = toNumericString(parsed.taxRate)
        if (parsed.taxRate == null) {
          record.taxAmount = null
        }
      } else if (hasTaxRateIdInput && parsed.taxRateId === null) {
        record.taxRate = null
        record.taxAmount = null
      }
    }
    if (parsed.channelId !== undefined) {
      record.channelId = parsed.channelId ?? null
    } else if (parsed.offerId !== undefined && targetOffer) {
      record.channelId = targetOffer.channelId
    }
    if (parsed.userId !== undefined) record.userId = parsed.userId ?? null
    if (parsed.userGroupId !== undefined) record.userGroupId = parsed.userGroupId ?? null
    if (parsed.customerId !== undefined) record.customerId = parsed.customerId ?? null
    if (parsed.customerGroupId !== undefined) record.customerGroupId = parsed.customerGroupId ?? null
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'startsAt')) {
      record.startsAt = parsed.startsAt ?? null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'endsAt')) {
      record.endsAt = parsed.endsAt ?? null
    }
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { priceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadPriceSnapshot(em, result.priceId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PriceSnapshot | undefined
    const after = snapshots.after as PriceSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.prices.update', 'Update product price'),
      resourceKind: 'catalog.price',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
        PRICE_CHANGE_KEYS
      ),
      payload: {
        undo: {
          before,
          after,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const after = payload?.after
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductPrice, { id: before.id })
    if (!record) {
      const { variant, product, offer } = await resolveSnapshotAssociations(em, before)
      record = em.create(CatalogProductPrice, {
        id: before.id,
        variant,
        product,
        offer,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        currencyCode: before.currencyCode,
        priceKind: em.getReference(CatalogPriceKind, before.priceKindId),
        kind: before.priceKindCode || before.kind,
        minQuantity: before.minQuantity,
        maxQuantity: before.maxQuantity ?? null,
        unitPriceNet: before.unitPriceNet ?? null,
        unitPriceGross: before.unitPriceGross ?? null,
        taxRate: before.taxRate ?? null,
        taxAmount: before.taxAmount ?? null,
        channelId: before.channelId ?? null,
        userId: before.userId ?? null,
        userGroupId: before.userGroupId ?? null,
        customerId: before.customerId ?? null,
        customerGroupId: before.customerGroupId ?? null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        startsAt: before.startsAt ? new Date(before.startsAt) : null,
        endsAt: before.endsAt ? new Date(before.endsAt) : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyPriceSnapshot(em, record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(
      before.custom ?? undefined,
      after?.custom ?? undefined
    )
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deletePriceCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { priceId: string }
> = {
  id: 'catalog.prices.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadPriceSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Price id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductPrice, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog price not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const { product } = await resolvePriceRecordAssociations(em, record)

    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadPriceSnapshot(baseEm, id)

    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_price,
          recordId: id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
    return { priceId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PriceSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.prices.delete', 'Delete product price'),
      resourceKind: 'catalog.price',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductPrice, { id: before.id })
    if (!record) {
      const { variant, product, offer } = await resolveSnapshotAssociations(em, before)
      record = em.create(CatalogProductPrice, {
        id: before.id,
        variant,
        product,
        offer,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        currencyCode: before.currencyCode,
        priceKind: em.getReference(CatalogPriceKind, before.priceKindId),
        kind: before.priceKindCode || before.kind,
        minQuantity: before.minQuantity,
        maxQuantity: before.maxQuantity ?? null,
        unitPriceNet: before.unitPriceNet ?? null,
        unitPriceGross: before.unitPriceGross ?? null,
        taxRate: before.taxRate ?? null,
        taxAmount: before.taxAmount ?? null,
        channelId: before.channelId ?? null,
        userId: before.userId ?? null,
        userGroupId: before.userGroupId ?? null,
        customerId: before.customerId ?? null,
        customerGroupId: before.customerGroupId ?? null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        startsAt: before.startsAt ? new Date(before.startsAt) : null,
        endsAt: before.endsAt ? new Date(before.endsAt) : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyPriceSnapshot(em, record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createPriceCommand)
registerCommand(updatePriceCommand)
registerCommand(deletePriceCommand)

async function resolvePriceRecordAssociations(
  em: EntityManager,
  record: CatalogProductPrice,
): Promise<{ product: CatalogProduct; variant: CatalogProductVariant | null }> {
  const variant = record.variant
    ? (typeof record.variant === 'string'
        ? await requireVariant(em, record.variant)
        : record.variant)
    : null
  if (record.product) {
    const product =
      typeof record.product === 'string'
        ? await requireProduct(em, record.product)
        : record.product
    return { product, variant }
  }
  if (variant?.product) {
    const productRef = variant.product
    const product =
      typeof productRef === 'string'
        ? await requireProduct(em, productRef)
        : productRef
    return { product, variant }
  }
  if (record.offer) {
    const offer =
      typeof record.offer === 'string'
        ? await requireOffer(em, record.offer)
        : record.offer
    const productRef = offer?.product ?? null
    if (productRef) {
      const product =
        typeof productRef === 'string'
          ? await requireProduct(em, productRef)
          : productRef
      return { product, variant }
    }
  }
  throw new CrudHttpError(400, { error: 'Catalog price is not linked to a product.' })
}
