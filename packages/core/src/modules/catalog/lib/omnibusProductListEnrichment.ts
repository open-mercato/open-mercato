import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CatalogOmnibusService } from '../services/catalogOmnibusService'
import type { OmnibusBlock, OmnibusConfig, OmnibusResolutionRequest } from './omnibusTypes'
import { isPromotionPriceKind, resolveOmnibusPresentedEntries } from './omnibusPresentedEntry'
import {
  resolvePriceChannelId,
  resolvePriceKindId,
  resolvePriceVariantId,
  selectBestPrice,
  type PriceRow,
  type PricingContext,
} from './pricing'

const logger = createLogger('catalog')

export type OmnibusProductListEntry = {
  item: { omnibus?: OmnibusBlock }
  productId: string
  candidates: PriceRow[]
  best: PriceRow
  context: PricingContext
}

export type AttachProductListOmnibusParams = {
  em: EntityManager
  container: { resolve: <T = unknown>(name: string) => T }
  tenantId: string | null | undefined
  entries: OmnibusProductListEntry[]
}

type EnabledEntry = OmnibusProductListEntry & {
  config: OmnibusConfig
  channelId: string | null
  presentedPriceKindId: string | null
  presentedPrice: PriceRow | null
}

async function loadEnabledConfigs(
  service: CatalogOmnibusService,
  tenantId: string,
  organizationIds: string[],
): Promise<Map<string, OmnibusConfig>> {
  const configs = await Promise.all(
    organizationIds.map((organizationId) => service.getConfig({ tenantId, organizationId })),
  )
  const enabled = new Map<string, OmnibusConfig>()
  organizationIds.forEach((organizationId, index) => {
    const config = configs[index]
    if (config && config.enabled === true) enabled.set(organizationId, config)
  })
  return enabled
}

function selectPresentedPrice(entry: OmnibusProductListEntry, presentedPriceKindId: string | null): PriceRow | null {
  if (!presentedPriceKindId || presentedPriceKindId === resolvePriceKindId(entry.best)) return entry.best
  return selectBestPrice(entry.candidates, {
    ...entry.context,
    priceKindId: presentedPriceKindId,
    currencyCode: entry.best.currencyCode,
  })
}

export async function attachProductListOmnibusBlocks(params: AttachProductListOmnibusParams): Promise<void> {
  const { em, container, entries } = params
  const tenantId = params.tenantId ?? null
  if (!tenantId || !entries.length) return
  try {
    const service = container.resolve<CatalogOmnibusService>('catalogOmnibusService')
    const organizationIds = Array.from(new Set(entries.map((entry) => entry.best.organizationId).filter(Boolean)))
    const configs = await loadEnabledConfigs(service, tenantId, organizationIds)
    if (!configs.size) return
    const enabled: EnabledEntry[] = []
    for (const entry of entries) {
      const config = configs.get(entry.best.organizationId)
      if (!config) continue
      const channelId = entry.context.channelId ?? resolvePriceChannelId(entry.best) ?? null
      const presentedPriceKindId = service.resolvePresentedPriceKindId(config, channelId, resolvePriceKindId(entry.best))
      enabled.push({
        ...entry,
        config,
        channelId,
        presentedPriceKindId,
        presentedPrice: selectPresentedPrice(entry, presentedPriceKindId),
      })
    }
    if (!enabled.length) return
    const presentedEntries = await resolveOmnibusPresentedEntries(
      em,
      enabled.map((entry) => entry.presentedPrice).filter((price): price is PriceRow => price !== null),
    )
    const requests: OmnibusResolutionRequest[] = enabled.map((entry) => ({
      context: {
        tenantId,
        organizationId: entry.best.organizationId,
        productId: entry.productId,
        variantId: entry.presentedPrice ? resolvePriceVariantId(entry.presentedPrice) : null,
        offerId: entry.context.offerId ?? null,
        channelId: entry.channelId,
        priceKindId: entry.presentedPriceKindId,
        currencyCode: entry.presentedPrice?.currencyCode ?? entry.best.currencyCode,
        isStorefront: false,
      },
      presentedEntry: entry.presentedPrice ? presentedEntries.get(entry.presentedPrice.id) ?? null : null,
      priceKindIsPromotion: isPromotionPriceKind(entry.presentedPrice),
    }))
    const blocks = await service.resolveOmnibusBlocks(em, requests)
    enabled.forEach((entry, index) => {
      const block = blocks[index]
      if (block) entry.item.omnibus = block
    })
  } catch (err) {
    logger.error('[internal] catalog products omnibus enrichment failed', {
      tenantId,
      productCount: entries.length,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.omnibus_list_enrichment_failed',
      attributes: { productCount: entries.length },
    })
  }
}
