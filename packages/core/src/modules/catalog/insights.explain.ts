import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainLoadContext, ExplainReferenceDetail } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
  toExplainTimestamp,
} from '@open-mercato/shared/modules/insights/helpers'
import { CatalogProductPrice } from './data/entities'

export const CATALOG_PRICE_REFERENCE_KIND = 'catalog.price'
export const CATALOG_PRICE_REFERENCE_FEATURES = ['catalog.products.view']

function readReferenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = value.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  return null
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveProductId(price: CatalogProductPrice): string | null {
  return readReferenceId(price.product) ?? (price.variant ? readReferenceId(price.variant.product) : null)
}

function toPriceReference(price: CatalogProductPrice): ExplainReferenceDetail {
  const priceKind = price.priceKind
  const productId = resolveProductId(price)
  return {
    kind: CATALOG_PRICE_REFERENCE_KIND,
    id: price.id,
    label: readText(priceKind?.title) ?? readText(priceKind?.code),
    href: productId ? `/backend/catalog/products/${encodeURIComponent(productId)}` : null,
    organizationId: price.organizationId,
    facts: {
      unitPriceNet: price.unitPriceNet ?? null,
      unitPriceGross: price.unitPriceGross ?? null,
      currencyCode: price.currencyCode,
      priceKindId: readReferenceId(priceKind),
      priceKindCode: readText(priceKind?.code),
      priceKindTitle: readText(priceKind?.title),
      displayMode: readText(priceKind?.displayMode),
      kind: price.kind,
      productId,
      variantId: readReferenceId(price.variant),
      offerId: readReferenceId(price.offer),
      channelId: price.channelId ?? null,
      customerGroupId: price.customerGroupId ?? null,
      customerSpecific: Boolean(price.customerId),
      userSpecific: Boolean(price.userId || price.userGroupId),
      minQuantity: price.minQuantity,
      maxQuantity: price.maxQuantity ?? null,
      startsAt: toExplainTimestamp(price.startsAt ?? null),
      endsAt: toExplainTimestamp(price.endsAt ?? null),
    },
  }
}

/**
 * Resolves catalog price rows for explanations in one query, restricted to the tenant
 * and the caller's organization scope. Facts expose the amounts and the conditions the
 * row applies under (price kind, channel, customer group, quantity range, validity
 * window); customer- and user-specific rows report only that they are specific.
 */
async function resolvePriceReferences(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainReferenceDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const priceIds = Array.from(new Set(normalizeExplainIds(ids, { uuidOnly: true }).map((id) => id.toLowerCase())))
  if (!organizationWhere || priceIds.length === 0) return []
  const prices = await findWithDecryption(
    ctx.em,
    CatalogProductPrice,
    { id: { $in: priceIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    { populate: ['priceKind', 'variant'] },
    resolveExplainDecryptionScope(ctx.scope),
  )
  return prices.map(toPriceReference)
}

export const explainConfig = defineExplainConfig({
  version: 1,
  referenceResolvers: [
    {
      kind: CATALOG_PRICE_REFERENCE_KIND,
      requiredFeatures: CATALOG_PRICE_REFERENCE_FEATURES,
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'catalog', code: 'catalog.insights_reference_failed', kind: CATALOG_PRICE_REFERENCE_KIND },
          () => resolvePriceReferences(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
