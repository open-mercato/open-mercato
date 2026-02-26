import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct, CatalogProductCategory, CatalogProductPrice, CatalogProductVariant } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

async function resolveEm() {
  const { resolve } = await createRequestContainer()
  return resolve('em') as EntityManager
}

function formatVariantPrice(amount: string | null | undefined, currencyCode: string | null | undefined): string | null {
  if (!amount) return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return currencyCode ? `${currencyCode.toUpperCase()} ${amount}` : amount
  if (!currencyCode) return value.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode.toUpperCase(),
    }).format(value)
  } catch {
    return `${currencyCode.toUpperCase()} ${value.toLocaleString()}`
  }
}

export async function loadCatalogProductPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('catalog.messageObjects.product.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveEm()
  const entity = await findOneWithDecryption(
    em,
    CatalogProduct,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!entity) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('customers.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  return {
    title: entity.title,
    subtitle: entity.subtitle ?? undefined,
  }
}

export async function loadCatalogVariantPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('catalog.variants.form.editTitle')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveEm()
  const variant = await findOneWithDecryption(
    em,
    CatalogProductVariant,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!variant) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('catalog.variants.form.errors.notFound'),
      statusColor: 'gray',
    }
  }

  const prices = await findWithDecryption(
    em,
    CatalogProductPrice,
    {
      variant,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    },
    { orderBy: { createdAt: 'ASC' }, limit: 10 },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  const firstPrice = prices.find((entry) => Boolean(entry.unitPriceGross || entry.unitPriceNet))
  const priceLabel = formatVariantPrice(
    firstPrice?.unitPriceGross ?? firstPrice?.unitPriceNet ?? null,
    firstPrice?.currencyCode ?? null,
  )

  const metadata: Record<string, string> = {}
  const skuLabel = t('catalog.variants.form.skuLabel')
  const pricesLabel = t('catalog.variants.form.pricesLabel')
  if (variant.sku && variant.sku.trim().length > 0) metadata[skuLabel] = variant.sku
  if (priceLabel) metadata[pricesLabel] = priceLabel

  return {
    title: variant.name,
    subtitle: variant.sku ?? undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

export async function loadCatalogCategoryPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('catalog.messageObjects.category.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveEm()
  const entity = await findOneWithDecryption(
    em,
    CatalogProductCategory,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!entity) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('customers.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  return {
    title: entity.name,
    subtitle: entity.description ?? undefined,
  }
}
