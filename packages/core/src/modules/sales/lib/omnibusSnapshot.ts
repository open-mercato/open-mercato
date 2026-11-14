import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogProductPrice } from '../../catalog/data/entities'
import { isPromotionPriceKind, resolveOmnibusPresentedEntries } from '../../catalog/lib/omnibusPresentedEntry'
import { resolvePriceChannelId, resolvePriceKindId, type PriceRow } from '../../catalog/lib/pricing'
import type { CatalogOmnibusService } from '../../catalog/services/catalogOmnibusService'

const logger = createLogger('sales')

export type OmnibusSnapshotTarget = {
  omnibusReferenceNet?: string | null
  omnibusReferenceGross?: string | null
  omnibusPromotionAnchorAt?: Date | null
  omnibusApplicabilityReason?: string | null
  isPersonalized?: boolean | null
  personalizationReason?: string | null
}

export type OmnibusSourceLine = {
  productId?: string | null
  productVariantId?: string | null
  priceId?: string | null
  currencyCode?: string | null
  metadata?: Record<string, unknown> | null
}

export type OmnibusDocumentScope = {
  tenantId: string
  organizationId: string
  channelId?: string | null
  currencyCode: string
}

export const PRICE_PERSONALIZATION_REASONS = [
  'customer_specific_price',
  'customer_group_price',
  'user_specific_price',
  'user_group_price',
] as const

export type PricePersonalizationReason = (typeof PRICE_PERSONALIZATION_REASONS)[number]

export type PricePersonalization = {
  isPersonalized: boolean
  personalizationReason: PricePersonalizationReason | null
}

/** The line upsert path records the applied price id on the line metadata rather than on the input. */
export function readOmnibusSourcePriceId(sourceLine: OmnibusSourceLine): string | null {
  if (typeof sourceLine.priceId === 'string' && sourceLine.priceId.length) return sourceLine.priceId
  const metadataPriceId = sourceLine.metadata?.priceId
  return typeof metadataPriceId === 'string' && metadataPriceId.length ? metadataPriceId : null
}

/** Null when the catalog module is absent, or during a bulk import where a per-line lookup is an N+1. */
export function resolveOmnibusService(ctx: Pick<CommandRuntimeContext, 'container' | 'bulkImport'>): CatalogOmnibusService | null {
  if (ctx.bulkImport) return null
  try {
    const service = ctx.container.resolve<CatalogOmnibusService | null>('catalogOmnibusService')
    return service ?? null
  } catch {
    return null
  }
}

/**
 * Art. 6(1)(ea) disclosure for a sold line, read from the price row that was actually applied:
 * it answers whether the price this buyer paid was selected for them.
 */
export function readPricePersonalization(price: {
  customerId?: string | null
  customerGroupId?: string | null
  userId?: string | null
  userGroupId?: string | null
}): PricePersonalization {
  if (price.customerId) return { isPersonalized: true, personalizationReason: 'customer_specific_price' }
  if (price.customerGroupId) return { isPersonalized: true, personalizationReason: 'customer_group_price' }
  if (price.userId) return { isPersonalized: true, personalizationReason: 'user_specific_price' }
  if (price.userGroupId) return { isPersonalized: true, personalizationReason: 'user_group_price' }
  return { isPersonalized: false, personalizationReason: null }
}

/**
 * Written once at line creation and never recomputed: the line is the record of what the buyer
 * was shown. Best-effort — a failure here never blocks the sales document write. Immutability
 * comes from the callers capturing only for new lines; `em` must be a fork so a failed lookup
 * cannot abort the parent transaction.
 */
export async function applyOmnibusSnapshotToLine(params: {
  em: EntityManager
  service: CatalogOmnibusService
  line: OmnibusSnapshotTarget
  sourceLine: OmnibusSourceLine
  document: OmnibusDocumentScope
  documentKind: 'order' | 'quote'
}): Promise<void> {
  const { em, service, line, sourceLine, document, documentKind } = params
  const priceId = readOmnibusSourcePriceId(sourceLine)
  if (!priceId) return
  const scope = { tenantId: document.tenantId, organizationId: document.organizationId }
  try {
    const price = (await findOneWithDecryption(
      em,
      CatalogProductPrice,
      { id: priceId, tenantId: document.tenantId, organizationId: document.organizationId },
      { populate: ['priceKind'] },
      scope,
    )) as PriceRow | null
    if (!price) return
    const presentedEntries = await resolveOmnibusPresentedEntries(em, [price])
    const block = await service.resolveOmnibusBlock(
      em,
      {
        tenantId: document.tenantId,
        organizationId: document.organizationId,
        productId: sourceLine.productId ?? null,
        variantId: sourceLine.productVariantId ?? null,
        offerId: null,
        channelId: document.channelId ?? resolvePriceChannelId(price),
        priceKindId: resolvePriceKindId(price),
        currencyCode: sourceLine.currencyCode ?? document.currencyCode,
        isStorefront: false,
      },
      presentedEntries.get(price.id) ?? null,
      isPromotionPriceKind(price),
    )
    if (!block) return
    line.omnibusReferenceNet = block.lowestPriceNet
    line.omnibusReferenceGross = block.lowestPriceGross
    line.omnibusPromotionAnchorAt = block.promotionAnchorAt ? new Date(block.promotionAnchorAt) : null
    line.omnibusApplicabilityReason = block.applicabilityReason
    const personalization = readPricePersonalization(price)
    line.isPersonalized = personalization.isPersonalized
    line.personalizationReason = personalization.personalizationReason
  } catch (err) {
    logger.error('[internal] sales line omnibus snapshot capture failed', {
      documentKind,
      priceId,
      productId: sourceLine.productId ?? null,
      tenantId: document.tenantId,
      organizationId: document.organizationId,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'sales',
      code: 'sales.omnibus_snapshot_capture_failed',
      attributes: { documentKind, priceId },
    })
  }
}
