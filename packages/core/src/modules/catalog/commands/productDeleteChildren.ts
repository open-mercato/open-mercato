import type { EntityManager } from '@mikro-orm/postgresql'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogOffer,
  CatalogOptionSchemaTemplate,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductUnitConversion,
  CatalogProductVariant,
} from '../data/entities'
import type { CatalogGtinType, CatalogProductOptionSchema } from '../data/types'
import { cloneJson, emitCatalogQueryIndexEvent } from './shared'

type VariantDimensions = NonNullable<CatalogProductVariant['dimensions']>

export type ProductDeleteVariantSnapshot = {
  id: string
  productId: string
  name: string | null
  sku: string | null
  barcode: string | null
  gtinType: CatalogGtinType | null
  hsCode: string | null
  statusEntryId: string | null
  isDefault: boolean
  isActive: boolean
  weightValue: string | null
  weightUnit: string | null
  dimensions: VariantDimensions | null
  metadata: Record<string, unknown> | null
  taxRateId: string | null
  taxRate: string | null
  optionValues: Record<string, string> | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  customFieldsetCode: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom: Record<string, unknown> | null
}

export type ProductDeletePriceSnapshot = {
  id: string
  variantId: string | null
  productId: string | null
  offerId: string | null
  priceKindId: string
  currencyCode: string
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
}

export type ProductDeleteUnitConversionSnapshot = {
  id: string
  productId: string
  unitCode: string
  toBaseFactor: string
  sortOrder: number
  isActive: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ProductDeleteOptionSchemaSnapshot = {
  id: string
  name: string
  code: string
  description: string | null
  schema: CatalogProductOptionSchema
  metadata: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ProductDeleteChildrenSnapshot = {
  variants: ProductDeleteVariantSnapshot[]
  prices: ProductDeletePriceSnapshot[]
  unitConversions: ProductDeleteUnitConversionSnapshot[]
  optionSchemaTemplate: ProductDeleteOptionSchemaSnapshot | null
}

export type ProductDeleteOwner = {
  id: string
  organizationId: string
  tenantId: string
  optionSchemaId: string | null
  offerIds: string[]
}

export type ProductDeleteChildrenRestorePlan = ProductDeleteChildrenSnapshot

type EntityRef = { id: string } | string | null | undefined

function refId(ref: EntityRef): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

export function isProductOwnedOptionSchemaTemplate(
  template: CatalogOptionSchemaTemplate | string | null | undefined,
): template is CatalogOptionSchemaTemplate {
  if (!template || typeof template === 'string') return false
  const metadata = template.metadata
  if (!metadata || typeof metadata !== 'object') return false
  const source = (metadata as Record<string, unknown>).source
  return source === 'product'
}

export async function captureProductDeleteChildren(
  em: EntityManager,
  owner: Pick<ProductDeleteOwner, 'id' | 'organizationId' | 'tenantId' | 'optionSchemaId'>,
): Promise<ProductDeleteChildrenSnapshot> {
  const scope = { tenantId: owner.tenantId, organizationId: owner.organizationId }
  const variantRecords = await findWithDecryption(em, CatalogProductVariant, { product: owner.id }, {}, scope)
  const variantIds = variantRecords.map((variant) => variant.id)
  const priceRecords = await findWithDecryption(
    em,
    CatalogProductPrice,
    variantIds.length ? { $or: [{ variant: { $in: variantIds } }, { product: owner.id }] } : { product: owner.id },
    {},
    scope,
  )
  const conversionRecords = await findWithDecryption(em, CatalogProductUnitConversion, { product: owner.id }, {}, scope)
  const template = owner.optionSchemaId
    ? await findOneWithDecryption(em, CatalogOptionSchemaTemplate, { id: owner.optionSchemaId }, {}, scope)
    : null
  const variants: ProductDeleteVariantSnapshot[] = []
  for (const variant of variantRecords) {
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.catalog.catalog_product_variant,
      recordId: variant.id,
      tenantId: variant.tenantId,
      organizationId: variant.organizationId,
    })
    variants.push({
      id: variant.id,
      productId: refId(variant.product) ?? owner.id,
      name: variant.name ?? null,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      gtinType: variant.gtinType ?? null,
      hsCode: variant.hsCode ?? null,
      statusEntryId: variant.statusEntryId ?? null,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      weightValue: variant.weightValue ?? null,
      weightUnit: variant.weightUnit ?? null,
      dimensions: variant.dimensions ? cloneJson(variant.dimensions) : null,
      metadata: variant.metadata ? cloneJson(variant.metadata) : null,
      taxRateId: variant.taxRateId ?? null,
      taxRate: variant.taxRate ?? null,
      optionValues: variant.optionValues ? cloneJson(variant.optionValues) : null,
      defaultMediaId: variant.defaultMediaId ?? null,
      defaultMediaUrl: variant.defaultMediaUrl ?? null,
      customFieldsetCode: variant.customFieldsetCode ?? null,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
      deletedAt: toIso(variant.deletedAt),
      custom: Object.keys(custom).length ? custom : null,
    })
  }
  const prices: ProductDeletePriceSnapshot[] = []
  for (const price of priceRecords) {
    const priceKindId = refId(price.priceKind)
    if (!priceKindId) throw new Error(`[internal] Catalog price ${price.id} has no price kind`)
    prices.push({
      id: price.id,
      variantId: refId(price.variant),
      productId: refId(price.product),
      offerId: refId(price.offer),
      priceKindId,
      currencyCode: price.currencyCode,
      kind: price.kind,
      minQuantity: price.minQuantity,
      maxQuantity: price.maxQuantity ?? null,
      unitPriceNet: price.unitPriceNet ?? null,
      unitPriceGross: price.unitPriceGross ?? null,
      taxRate: price.taxRate ?? null,
      taxAmount: price.taxAmount ?? null,
      channelId: price.channelId ?? null,
      userId: price.userId ?? null,
      userGroupId: price.userGroupId ?? null,
      customerId: price.customerId ?? null,
      customerGroupId: price.customerGroupId ?? null,
      metadata: price.metadata ? cloneJson(price.metadata) : null,
      startsAt: toIso(price.startsAt),
      endsAt: toIso(price.endsAt),
      createdAt: price.createdAt.toISOString(),
      updatedAt: price.updatedAt.toISOString(),
    })
  }
  const unitConversions: ProductDeleteUnitConversionSnapshot[] = conversionRecords.map((conversion) => ({
    id: conversion.id,
    productId: refId(conversion.product) ?? owner.id,
    unitCode: conversion.unitCode,
    toBaseFactor: conversion.toBaseFactor,
    sortOrder: conversion.sortOrder,
    isActive: conversion.isActive,
    metadata: conversion.metadata ? cloneJson(conversion.metadata) : null,
    createdAt: conversion.createdAt.toISOString(),
    updatedAt: conversion.updatedAt.toISOString(),
    deletedAt: toIso(conversion.deletedAt),
  }))
  return {
    variants,
    prices,
    unitConversions,
    optionSchemaTemplate: isProductOwnedOptionSchemaTemplate(template)
      ? {
          id: template.id,
          name: template.name,
          code: template.code,
          description: template.description ?? null,
          schema: cloneJson(template.schema),
          metadata: template.metadata ? cloneJson(template.metadata) : null,
          isActive: template.isActive,
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
          deletedAt: toIso(template.deletedAt),
        }
      : null,
  }
}

function restoreConflict(kind: string, id: string): Error {
  return new Error(`[internal] Cannot restore catalog product ${kind} ${id}: it does not belong to the restored product`)
}

function sameScope(row: { tenantId: string; organizationId: string }, owner: ProductDeleteOwner): boolean {
  return row.tenantId === owner.tenantId && row.organizationId === owner.organizationId
}

function asList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

export async function planProductDeleteChildrenRestore(
  em: EntityManager,
  owner: ProductDeleteOwner,
  children: ProductDeleteChildrenSnapshot | null | undefined,
): Promise<ProductDeleteChildrenRestorePlan | null> {
  if (!children) return null
  const scope = { tenantId: owner.tenantId, organizationId: owner.organizationId }
  const variantSnapshots = asList(children.variants)
  const priceSnapshots = asList(children.prices)
  const conversionSnapshots = asList(children.unitConversions)
  const templateSnapshot =
    children.optionSchemaTemplate && children.optionSchemaTemplate.id === owner.optionSchemaId
      ? children.optionSchemaTemplate
      : null
  const ownVariantIds = new Set(variantSnapshots.map((variant) => variant.id))
  const offerIds = new Set(owner.offerIds)

  const priceOwned = (price: { variantId: string | null; productId: string | null }) =>
    (price.variantId !== null && ownVariantIds.has(price.variantId)) || price.productId === owner.id

  for (const variant of variantSnapshots) {
    if (variant.productId !== owner.id) throw restoreConflict('variant', variant.id)
  }
  for (const conversion of conversionSnapshots) {
    if (conversion.productId !== owner.id) throw restoreConflict('unit conversion', conversion.id)
  }
  for (const price of priceSnapshots) {
    if (!priceOwned(price)) throw restoreConflict('price', price.id)
  }

  const foreignVariantIds = new Set<string>()
  const foreignProductIds = new Set<string>()
  const trackVariant = (id: string | null) => {
    if (id && !ownVariantIds.has(id)) foreignVariantIds.add(id)
  }
  const trackProduct = (id: string | null) => {
    if (id && id !== owner.id) foreignProductIds.add(id)
  }
  for (const price of priceSnapshots) {
    trackVariant(price.variantId)
    trackProduct(price.productId)
  }

  const existingVariants = variantSnapshots.length
    ? await findWithDecryption(em, CatalogProductVariant, { id: { $in: variantSnapshots.map((entry) => entry.id) } }, {}, scope)
    : []
  const existingPrices = priceSnapshots.length
    ? await findWithDecryption(em, CatalogProductPrice, { id: { $in: priceSnapshots.map((entry) => entry.id) } }, {}, scope)
    : []
  const existingConversions = conversionSnapshots.length
    ? await findWithDecryption(
        em,
        CatalogProductUnitConversion,
        { id: { $in: conversionSnapshots.map((entry) => entry.id) } },
        {},
        scope,
      )
    : []
  const existingTemplate = templateSnapshot
    ? await findOneWithDecryption(em, CatalogOptionSchemaTemplate, { id: templateSnapshot.id }, {}, scope)
    : null
  const foreignVariants = foreignVariantIds.size
    ? await findWithDecryption(
        em,
        CatalogProductVariant,
        { id: { $in: Array.from(foreignVariantIds) }, tenantId: owner.tenantId, organizationId: owner.organizationId },
        {},
        scope,
      )
    : []
  const foreignProducts = foreignProductIds.size
    ? await findWithDecryption(
        em,
        CatalogProduct,
        { id: { $in: Array.from(foreignProductIds) }, tenantId: owner.tenantId, organizationId: owner.organizationId },
        {},
        scope,
      )
    : []

  for (const variant of existingVariants) {
    if (!sameScope(variant, owner) || refId(variant.product) !== owner.id) throw restoreConflict('variant', variant.id)
  }
  for (const conversion of existingConversions) {
    if (!sameScope(conversion, owner) || refId(conversion.product) !== owner.id) {
      throw restoreConflict('unit conversion', conversion.id)
    }
  }
  for (const price of existingPrices) {
    if (!sameScope(price, owner) || !priceOwned({ variantId: refId(price.variant), productId: refId(price.product) })) {
      throw restoreConflict('price', price.id)
    }
  }
  if (existingTemplate && !sameScope(existingTemplate, owner)) {
    throw restoreConflict('option schema', existingTemplate.id)
  }

  const existingVariantIds = new Set(existingVariants.map((entry) => entry.id))
  const existingPriceIds = new Set(existingPrices.map((entry) => entry.id))
  const existingConversionIds = new Set(existingConversions.map((entry) => entry.id))
  const availableForeignVariantIds = new Set(foreignVariants.map((entry) => entry.id))
  const availableForeignProductIds = new Set(foreignProducts.map((entry) => entry.id))
  const variantAvailable = (id: string | null) =>
    id === null || ownVariantIds.has(id) || availableForeignVariantIds.has(id)
  const productAvailable = (id: string | null) =>
    id === null || id === owner.id || availableForeignProductIds.has(id)

  return {
    optionSchemaTemplate: templateSnapshot && !existingTemplate ? templateSnapshot : null,
    unitConversions: conversionSnapshots.filter((entry) => !existingConversionIds.has(entry.id)),
    variants: variantSnapshots.filter((entry) => !existingVariantIds.has(entry.id)),
    prices: priceSnapshots
      .filter(
        (entry) =>
          !existingPriceIds.has(entry.id) && variantAvailable(entry.variantId) && productAvailable(entry.productId),
      )
      .map((entry) => ({ ...entry, offerId: entry.offerId && offerIds.has(entry.offerId) ? entry.offerId : null })),
  }
}

export function restoreProductOptionSchemaTemplate(
  em: EntityManager,
  owner: ProductDeleteOwner,
  plan: ProductDeleteChildrenRestorePlan | null,
): void {
  const snapshot = plan?.optionSchemaTemplate
  if (!snapshot) return
  const template = em.create(CatalogOptionSchemaTemplate, {
    id: snapshot.id,
    organizationId: owner.organizationId,
    tenantId: owner.tenantId,
    name: snapshot.name,
    code: snapshot.code,
    description: snapshot.description ?? null,
    schema: cloneJson(snapshot.schema),
    metadata: snapshot.metadata ? cloneJson(snapshot.metadata) : null,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  })
  em.persist(template)
}

/**
 * Child rows are created on a fork that shares the undo transaction instead of on the
 * EntityManager holding the restored product: the tenant encryption subscriber walks the
 * loaded graph of every created entity, which is quadratic once a product has hundreds of
 * prices attached to already-managed variants.
 */
export function buildProductDeleteChildrenRestorePhases(
  em: EntityManager,
  owner: ProductDeleteOwner,
  plan: ProductDeleteChildrenRestorePlan | null,
): Array<() => Promise<void>> {
  if (!plan) return []
  const scope = { organizationId: owner.organizationId, tenantId: owner.tenantId }
  let childEm: EntityManager | null = null
  const resolveChildEm = (): EntityManager => {
    childEm ??= em.fork({ keepTransactionContext: true })
    return childEm
  }
  return [
    async () => {
      const target = resolveChildEm()
      for (const snapshot of plan.unitConversions) {
        target.persist(
          target.create(CatalogProductUnitConversion, {
            id: snapshot.id,
            ...scope,
            product: target.getReference(CatalogProduct, snapshot.productId),
            unitCode: snapshot.unitCode,
            toBaseFactor: snapshot.toBaseFactor,
            sortOrder: snapshot.sortOrder,
            isActive: snapshot.isActive,
            metadata: snapshot.metadata ? cloneJson(snapshot.metadata) : null,
            createdAt: new Date(snapshot.createdAt),
            updatedAt: new Date(snapshot.updatedAt),
            deletedAt: toDate(snapshot.deletedAt),
          }),
        )
      }
      await target.flush()
    },
    async () => {
      const target = resolveChildEm()
      for (const snapshot of plan.variants) {
        target.persist(
          target.create(CatalogProductVariant, {
            id: snapshot.id,
            ...scope,
            product: target.getReference(CatalogProduct, snapshot.productId),
            name: snapshot.name ?? null,
            sku: snapshot.sku ?? null,
            barcode: snapshot.barcode ?? null,
            gtinType: snapshot.gtinType ?? null,
            hsCode: snapshot.hsCode ?? null,
            statusEntryId: snapshot.statusEntryId ?? null,
            isDefault: snapshot.isDefault,
            isActive: snapshot.isActive,
            weightValue: snapshot.weightValue ?? null,
            weightUnit: snapshot.weightUnit ?? null,
            dimensions: snapshot.dimensions ? cloneJson(snapshot.dimensions) : null,
            metadata: snapshot.metadata ? cloneJson(snapshot.metadata) : null,
            taxRateId: snapshot.taxRateId ?? null,
            taxRate: snapshot.taxRate ?? null,
            optionValues: snapshot.optionValues ? cloneJson(snapshot.optionValues) : null,
            defaultMediaId: snapshot.defaultMediaId ?? null,
            defaultMediaUrl: snapshot.defaultMediaUrl ?? null,
            customFieldsetCode: snapshot.customFieldsetCode ?? null,
            createdAt: new Date(snapshot.createdAt),
            updatedAt: new Date(snapshot.updatedAt),
            deletedAt: toDate(snapshot.deletedAt),
          }),
        )
      }
      await target.flush()
    },
    async () => {
      const target = resolveChildEm()
      for (const snapshot of plan.prices) {
        target.persist(
          target.create(CatalogProductPrice, {
            id: snapshot.id,
            ...scope,
            variant: snapshot.variantId ? target.getReference(CatalogProductVariant, snapshot.variantId) : null,
            product: snapshot.productId ? target.getReference(CatalogProduct, snapshot.productId) : null,
            offer: snapshot.offerId ? target.getReference(CatalogOffer, snapshot.offerId) : null,
            priceKind: target.getReference(CatalogPriceKind, snapshot.priceKindId),
            currencyCode: snapshot.currencyCode,
            kind: snapshot.kind,
            minQuantity: snapshot.minQuantity,
            maxQuantity: snapshot.maxQuantity ?? null,
            unitPriceNet: snapshot.unitPriceNet ?? null,
            unitPriceGross: snapshot.unitPriceGross ?? null,
            taxRate: snapshot.taxRate ?? null,
            taxAmount: snapshot.taxAmount ?? null,
            channelId: snapshot.channelId ?? null,
            userId: snapshot.userId ?? null,
            userGroupId: snapshot.userGroupId ?? null,
            customerId: snapshot.customerId ?? null,
            customerGroupId: snapshot.customerGroupId ?? null,
            metadata: snapshot.metadata ? cloneJson(snapshot.metadata) : null,
            startsAt: toDate(snapshot.startsAt),
            endsAt: toDate(snapshot.endsAt),
            createdAt: new Date(snapshot.createdAt),
            updatedAt: new Date(snapshot.updatedAt),
          }),
        )
      }
      await target.flush()
    },
  ]
}

export async function emitProductDeleteChildrenRestoreSideEffects(opts: {
  ctx: CommandRuntimeContext
  dataEngine: DataEngine
  owner: ProductDeleteOwner
  children: ProductDeleteChildrenSnapshot | null | undefined
  plan: ProductDeleteChildrenRestorePlan | null
}): Promise<void> {
  const { ctx, dataEngine, owner, children, plan } = opts
  const variants = asList(children?.variants)
  const createdVariantIds = new Set(asList(plan?.variants).map((variant) => variant.id))
  for (const variant of variants) {
    if (!variant.custom || !Object.keys(variant.custom).length) continue
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.catalog.catalog_product_variant,
      recordId: variant.id,
      organizationId: owner.organizationId,
      tenantId: owner.tenantId,
      values: variant.custom,
    })
  }
  for (const variant of variants) {
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_product_variant,
      recordId: variant.id,
      organizationId: owner.organizationId,
      tenantId: owner.tenantId,
      action: 'created',
      ...(createdVariantIds.has(variant.id) ? {} : { coverageBaseDelta: 0 }),
    })
  }
}
