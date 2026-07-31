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

/**
 * The catalog price the line was created from. The line-upsert path does not
 * carry `priceId` as a column — it records it on the line metadata — so both
 * shapes are accepted.
 */
export function readOmnibusSourcePriceId(sourceLine: OmnibusSourceLine): string | null {
  if (typeof sourceLine.priceId === 'string' && sourceLine.priceId.length) {
    return sourceLine.priceId
  }
  const metadataPriceId = sourceLine.metadata?.priceId
  return typeof metadataPriceId === 'string' && metadataPriceId.length ? metadataPriceId : null
}

/**
 * Resolve the optional catalog omnibus service.
 *
 * Returns null when the catalog module is absent (EC-25) and when the command
 * runs under bulk import (rule M-9) — per-line resolution forks an EM and runs a
 * price lookup plus a full history resolve, an N+1 at import scale.
 */
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
 * Capture the omnibus reference block on a newly created sales line.
 *
 * The snapshot is written once, at line creation, and is never recomputed on a
 * later edit: the line is the legal record of what the buyer was shown at
 * purchase time. Capture is best-effort — every failure is logged and swallowed
 * so order/quote creation can never be blocked by it.
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
  // `em` must be a forked EntityManager (caller's responsibility) so a failed
  // lookup cannot abort the parent transaction.
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
    // Resolve the entry for the price actually being sold, so the reduction is excluded from
    // its own reference window (EC-7). Passing null here would let the promo price become the
    // reference stored on the line — the value the shop must be able to prove afterwards.
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
