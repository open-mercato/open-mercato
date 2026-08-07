import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CatalogProductPrice } from '../../catalog/data/entities'
import type { CatalogOmnibusService } from '../../catalog/services/catalogOmnibusService'
import type { OmnibusPersonalization } from '../../catalog/lib/omnibusTypes'

const logger = createLogger('sales')

// Omnibus (EU 98/6/EC Art. 6a) snapshot capture for sales lines.
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

/** The upsert path records the price id on the line metadata rather than a column. */
export function readOmnibusSourcePriceId(sourceLine: OmnibusSourceLine): string | null {
  if (typeof sourceLine.priceId === 'string' && sourceLine.priceId.length) {
    return sourceLine.priceId
  }
  const metadataPriceId = sourceLine.metadata?.priceId
  return typeof metadataPriceId === 'string' && metadataPriceId.length ? metadataPriceId : null
}

/** Null when catalog is absent (EC-25) or under bulk import, where this is an N+1 (M-9). */
export function resolveOmnibusService(ctx: CommandRuntimeContext): CatalogOmnibusService | null {
  if (ctx.bulkImport) return null
  try {
    const service: unknown = ctx.container.resolve('catalogOmnibusService')
    return (service as CatalogOmnibusService | null) ?? null
  } catch {
    return null
  }
}

export function readOmnibusPersonalization(block: unknown): OmnibusPersonalization | null {
  if (!block || typeof block !== 'object') return null
  const record = block as Record<string, unknown>
  if (typeof record.isPersonalized !== 'boolean') return null
  const reason = record.personalizationReason
  return {
    isPersonalized: record.isPersonalized,
    personalizationReason: typeof reason === 'string' ? reason : null,
  }
}

/**
 * Written once at line creation and never recomputed: the line is the legal record of what
 * the buyer was shown. Best-effort — a failure here must never block order creation.
 * Immutability comes from the caller guarding on `!existing`, not from this function.
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
  // `em` must be a fork so a failed lookup cannot abort the parent transaction.
  try {
    const priceId = readOmnibusSourcePriceId(sourceLine)
    if (!priceId) return
    const price = await findOneWithDecryption(
      em,
      CatalogProductPrice,
      {
        id: priceId,
        organizationId: document.organizationId,
        tenantId: document.tenantId,
      },
      { populate: ['priceKind'] },
      { tenantId: document.tenantId, organizationId: document.organizationId },
    )
    if (!price) return
    // EC-7: the entry actually being sold, so the reduction is excluded from its own window.
    const presentedEntry = await service.resolvePresentedEntryForPrice(
      em,
      { tenantId: document.tenantId, organizationId: document.organizationId },
      price.id,
    )
    const block = await service.resolveOmnibusBlock(
      em,
      {
        tenantId: document.tenantId,
        organizationId: document.organizationId,
        productId: sourceLine.productId ?? null,
        variantId: sourceLine.productVariantId ?? null,
        offerId: null,
        priceKindId: price.priceKind.id,
        currencyCode: sourceLine.currencyCode ?? document.currencyCode,
        channelId: document.channelId ?? null,
        isStorefront: false,
      },
      presentedEntry,
      price.priceKind.isPromotion ?? false,
    )
    if (!block) return
    line.omnibusReferenceNet = block.lowestPriceNet ?? null
    line.omnibusReferenceGross = block.lowestPriceGross ?? null
    line.omnibusPromotionAnchorAt = block.promotionAnchorAt ? new Date(block.promotionAnchorAt) : null
    line.omnibusApplicabilityReason = block.applicabilityReason ?? null
    const personalization = readOmnibusPersonalization(block)
    if (personalization) {
      line.isPersonalized = personalization.isPersonalized
      line.personalizationReason = personalization.personalizationReason
    }
  } catch (err) {
    logger.error('sales.lines omnibus snapshot capture failed', {
      documentKind,
      productId: sourceLine.productId ?? null,
      err,
    })
  }
}
