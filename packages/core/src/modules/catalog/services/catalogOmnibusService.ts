import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { CacheStrategy } from '@open-mercato/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceHistoryEntry, CatalogProductPrice } from '../data/entities'
import type { OmnibusConfig, OmnibusChannelConfig } from '../data/validators'
import { OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, MS_PER_DAY, buildHistoryEntry } from '../lib/omnibus'
import type { PriceHistorySnapshot } from '../lib/omnibus'
import type {
  OmnibusResolutionContext,
  OmnibusLowestPriceResult,
  OmnibusBlock,
  OmnibusHistoryRow,
  OmnibusApplicabilityReason,
} from '../lib/omnibusTypes'

export type {
  OmnibusResolutionContext,
  OmnibusLowestPriceResult,
  OmnibusBlock,
  OmnibusHistoryRow,
}

const CACHE_TTL_MS = 5 * 60 * 1000

export interface BackfillChannelResult {
  inserted: number
  skipped: number
}

export interface CatalogOmnibusService {
  getConfig(context?: { organizationId?: string | null }): Promise<OmnibusConfig>
  getLowestPrice(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    presentedPriceEntry?: OmnibusHistoryRow | null,
  ): Promise<OmnibusLowestPriceResult>
  resolveOmnibusBlock(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    presentedPriceEntry: OmnibusHistoryRow | null,
    priceKindIsPromotion: boolean,
  ): Promise<OmnibusBlock | null>
  backfillChannel(
    em: EntityManager,
    params: { organizationId: string; tenantId: string; channelId: string | null; lookbackDays: number; batchSize?: number },
  ): Promise<BackfillChannelResult>
}

export class DefaultCatalogOmnibusService implements CatalogOmnibusService {
  constructor(
    private readonly moduleConfigService: ModuleConfigService,
    private readonly cache: CacheStrategy,
  ) {}

  async getConfig(context?: { organizationId?: string | null }): Promise<OmnibusConfig> {
    const value = await this.moduleConfigService.getValue<OmnibusConfig>(
      OMNIBUS_MODULE_ID,
      OMNIBUS_CONFIG_KEY,
      { defaultValue: {}, context },
    )
    return value ?? {}
  }

  async getLowestPrice(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    presentedPriceEntry?: OmnibusHistoryRow | null,
  ): Promise<OmnibusLowestPriceResult> {
    const config = await this.getConfig({ organizationId: ctx.organizationId })
    return this.computeLowestPrice(em, ctx, config, presentedPriceEntry)
  }

  private async computeLowestPrice(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    config: OmnibusConfig,
    presentedPriceEntry?: OmnibusHistoryRow | null,
  ): Promise<OmnibusLowestPriceResult> {
    if (!config.enabled) {
      return earlyExitResult('no_history', 30, 'gross')
    }

    const enabledCountryCodes = config.enabledCountryCodes ?? []
    if (enabledCountryCodes.length === 0) {
      return earlyExitResult('not_in_eu_market', config.lookbackDays ?? 30, config.minimizationAxis ?? 'gross')
    }

    let channelConfig = ctx.channelId ? config.channels?.[ctx.channelId] : undefined

    if (ctx.channelId == null) {
      const effectiveMode =
        ctx.isStorefront === true ? 'require_channel' : (config.noChannelMode ?? 'best_effort')
      if (effectiveMode === 'require_channel') {
        return earlyExitResult('missing_channel_context', config.lookbackDays ?? 30, config.minimizationAxis ?? 'gross')
      }
    } else {
      const countryCode = channelConfig?.countryCode ?? null
      if (countryCode == null || !enabledCountryCodes.includes(countryCode)) {
        return earlyExitResult('not_in_eu_market', config.lookbackDays ?? 30, config.minimizationAxis ?? 'gross')
      }
    }

    const lookbackDays = channelConfig?.lookbackDays ?? config.lookbackDays ?? 30
    const axis = (channelConfig?.minimizationAxis ?? config.minimizationAxis ?? 'gross') as 'gross' | 'net'

    let firstOfferEntry: OmnibusHistoryRow | null = null
    const resolvedOfferId = ctx.offerId ?? presentedPriceEntry?.offerId ?? null
    if (resolvedOfferId) {
      firstOfferEntry = await this.fetchFirstOfferEntry(em, ctx, resolvedOfferId)
    }

    if (ctx.offerId && firstOfferEntry && channelConfig?.progressiveReductionRule === true) {
      const progressiveResult = await this.resolveProgressiveReduction(em, ctx, firstOfferEntry, axis, lookbackDays)
      if (progressiveResult) {
        await this.cache.set(buildCacheKey(ctx, axis, new Date(progressiveResult.windowStart), null), progressiveResult, { ttl: CACHE_TTL_MS, tags: [buildCacheTag(ctx)] })
        return progressiveResult
      }
    }

    const perishableResult = await this.resolvePerishableRule(em, ctx, channelConfig, lookbackDays, axis)
    if (perishableResult) return perishableResult

    const newArrivalAdj = this.resolveNewArrivalAdjustment(channelConfig, ctx, lookbackDays)
    const effectiveLookbackDays = newArrivalAdj?.lookbackDays ?? lookbackDays

    let promotionAnchorAt: Date | null = null
    if (presentedPriceEntry?.startsAt) {
      promotionAnchorAt = new Date(presentedPriceEntry.startsAt)
    } else if (firstOfferEntry) {
      promotionAnchorAt = new Date(firstOfferEntry.recordedAt)
    }

    const now = new Date()
    const windowEnd = promotionAnchorAt ?? now
    const windowStart = subtractDays(windowEnd, effectiveLookbackDays)

    const cacheKey = buildCacheKey(ctx, axis, windowStart, promotionAnchorAt)
    const cached = (await this.cache.get(cacheKey)) as OmnibusLowestPriceResult | null
    if (cached) return cached

    const baseline = await this.fetchBaseline(em, ctx, windowStart)
    const inWindow = await this.fetchInWindow(em, ctx, windowStart, windowEnd)

    const candidates: OmnibusHistoryRow[] = [
      ...(baseline ? [baseline] : []),
      ...inWindow,
    ]

    let lowestRow: OmnibusHistoryRow | null = null
    let lowestVal = Infinity
    for (const row of candidates) {
      const val = getPriceValue(row, axis)
      if (val < lowestVal) {
        lowestVal = val
        lowestRow = row
      }
    }

    let previousRow: OmnibusHistoryRow | null = null
    let insufficientHistory = false
    if (baseline) {
      previousRow = baseline
    } else if (inWindow.length > 0) {
      previousRow = await this.fetchOldestInWindow(em, ctx, windowStart, windowEnd)
      insufficientHistory = true
    }

    const coverageStartAt = insufficientHistory && previousRow ? previousRow.recordedAt : null

    const result: OmnibusLowestPriceResult = {
      lowestRow,
      previousRow,
      insufficientHistory,
      promotionAnchorAt: promotionAnchorAt ? promotionAnchorAt.toISOString() : null,
      coverageStartAt,
      applicabilityReason: newArrivalAdj ? newArrivalAdj.applicabilityReason : undefined,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      lookbackDays: effectiveLookbackDays,
      minimizationAxis: axis,
    }

    await this.cache.set(cacheKey, result, {
      ttl: CACHE_TTL_MS,
      tags: [buildCacheTag(ctx)],
    })

    return result
  }

  async resolveOmnibusBlock(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    presentedPriceEntry: OmnibusHistoryRow | null,
    priceKindIsPromotion: boolean,
  ): Promise<OmnibusBlock | null> {
    let config: OmnibusConfig
    try {
      config = await this.getConfig({ organizationId: ctx.organizationId })
    } catch (err) {
      console.error('[catalog:omnibus] Failed to load omnibus config', { organizationId: ctx.organizationId, err })
      return null
    }
    if (!config.enabled) return null

    const presentedPriceKindId = config.channels?.[ctx.channelId ?? '']?.presentedPriceKindId
      ?? config.defaultPresentedPriceKindId
      ?? ctx.priceKindId

    let result: OmnibusLowestPriceResult
    try {
      result = await this.computeLowestPrice(em, ctx, config, presentedPriceEntry)
    } catch (err) {
      console.error('[catalog:omnibus] resolveOmnibusBlock failed', { productId: ctx.productId, channelId: ctx.channelId, err })
      return null
    }

    if (result.applicabilityReason === 'not_in_eu_market' || result.applicabilityReason === 'missing_channel_context') {
      return buildEmptyBlock(presentedPriceKindId, ctx.currencyCode, result, result.applicabilityReason)
    }

    if (!result.lowestRow) {
      return buildEmptyBlock(presentedPriceKindId, ctx.currencyCode, result, result.applicabilityReason ?? 'no_history')
    }

    const applicable =
      presentedPriceEntry?.startsAt != null ||
      presentedPriceEntry?.offerId != null ||
      presentedPriceEntry?.isAnnounced === true ||
      priceKindIsPromotion === true

    let applicabilityReason: OmnibusApplicabilityReason
    if (result.applicabilityReason) {
      applicabilityReason = result.applicabilityReason
    } else if (result.insufficientHistory) {
      applicabilityReason = 'insufficient_history'
    } else if (applicable) {
      applicabilityReason = 'announced_promotion'
    } else {
      applicabilityReason = 'not_announced'
    }

    return {
      presentedPriceKindId,
      lookbackDays: result.lookbackDays,
      minimizationAxis: result.minimizationAxis,
      promotionAnchorAt: result.promotionAnchorAt,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      coverageStartAt: result.coverageStartAt,
      lowestPriceNet: result.lowestRow.unitPriceNet,
      lowestPriceGross: result.lowestRow.unitPriceGross,
      previousPriceNet: result.previousRow?.unitPriceNet ?? null,
      previousPriceGross: result.previousRow?.unitPriceGross ?? null,
      currencyCode: ctx.currencyCode,
      applicable,
      applicabilityReason,
    }
  }

  private async fetchBaseline(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    windowStart: Date,
  ): Promise<OmnibusHistoryRow | null> {
    const filters = buildScopeFilters(ctx)
    filters.recordedAt = { $lte: windowStart }

    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters as Record<string, unknown>,
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  private async fetchInWindow(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<OmnibusHistoryRow[]> {
    const filters = buildScopeFilters(ctx)
    filters.recordedAt = { $gt: windowStart, $lte: windowEnd }

    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters as Record<string, unknown>,
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1000 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return rows.map(mapRow)
  }

  private async fetchOldestInWindow(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<OmnibusHistoryRow | null> {
    const filters = buildScopeFilters(ctx)
    filters.recordedAt = { $gt: windowStart, $lte: windowEnd }

    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters as Record<string, unknown>,
      { orderBy: { recordedAt: 'ASC', id: 'ASC' }, limit: 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  private async fetchFirstOfferEntry(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    offerId: string,
  ): Promise<OmnibusHistoryRow | null> {
    const filters = buildScopeFilters({ ...ctx, offerId })
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters as Record<string, unknown>,
      { orderBy: { recordedAt: 'ASC', id: 'ASC' }, limit: 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  private async resolveProgressiveReduction(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    firstOfferEntry: OmnibusHistoryRow,
    axis: 'gross' | 'net',
    lookbackDays: number,
  ): Promise<OmnibusLowestPriceResult | null> {
    const filters = buildScopeFilters({ ...ctx, offerId: ctx.offerId! })
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters as Record<string, unknown>,
      { orderBy: { recordedAt: 'ASC', id: 'ASC' } },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const entries = rows.map(mapRow)
    if (entries.length < 2) return null

    let isProgressive = true
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!
      const curr = entries[i]!
      if (getPriceValue(curr, axis) > getPriceValue(prev, axis)) { isProgressive = false; break }
      const gapMs = new Date(curr.recordedAt).getTime() - new Date(prev.recordedAt).getTime()
      if (gapMs > 7 * MS_PER_DAY) { isProgressive = false; break }
    }
    if (!isProgressive) return null

    const lowestRow = entries[entries.length - 1]!

    const baselineFilters = buildScopeFilters({ ...ctx, offerId: undefined })
    baselineFilters.offerId = null
    baselineFilters.recordedAt = { $lt: new Date(firstOfferEntry.recordedAt) }
    const baselineRows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      baselineFilters as Record<string, unknown>,
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const previousRow = baselineRows[0] ? mapRow(baselineRows[0]) : null

    const now = new Date()
    const windowStart = subtractDays(now, lookbackDays)

    return {
      lowestRow,
      previousRow,
      insufficientHistory: false,
      promotionAnchorAt: new Date(firstOfferEntry.recordedAt).toISOString(),
      coverageStartAt: null,
      applicabilityReason: 'progressive_reduction_frozen',
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      lookbackDays,
      minimizationAxis: axis,
    }
  }

  private async resolvePerishableRule(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    channelConfig: OmnibusChannelConfig | undefined,
    lookbackDays: number,
    axis: 'gross' | 'net',
  ): Promise<OmnibusLowestPriceResult | null> {
    const rule = channelConfig?.perishableGoodsRule ?? 'standard'
    const exempt = ctx.omnibusExempt === true
    if (!exempt || rule === 'standard') return null

    if (rule === 'exempt') {
      return earlyExitResult('perishable_exempt', lookbackDays, axis)
    }

    if (rule === 'last_price') {
      const filters = buildScopeFilters(ctx)
      const rows = await findWithDecryption(
        em,
        CatalogPriceHistoryEntry,
        filters as Record<string, unknown>,
        { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1 },
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      )
      if (!rows[0]) return null
      const lastEntry = mapRow(rows[0])
      const now = new Date()
      const windowStart = subtractDays(now, lookbackDays)
      return {
        lowestRow: lastEntry,
        previousRow: lastEntry,
        insufficientHistory: false,
        promotionAnchorAt: null,
        coverageStartAt: null,
        applicabilityReason: 'perishable_last_price',
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        lookbackDays,
        minimizationAxis: axis,
      }
    }

    return null
  }

  async backfillChannel(
    em: EntityManager,
    params: { organizationId: string; tenantId: string; channelId: string | null; lookbackDays: number; batchSize?: number },
  ): Promise<BackfillChannelResult> {
    const { organizationId, tenantId, channelId, lookbackDays, batchSize = 500 } = params
    const windowStart = new Date(Date.now() - lookbackDays * MS_PER_DAY)
    const recordedAt = new Date(windowStart.getTime() - 1)

    const priceFilters: Record<string, unknown> = { organization_id: organizationId, tenant_id: tenantId }
    if (channelId) priceFilters.channel_id = channelId

    const totalPrices = await em.count(CatalogProductPrice, priceFilters)

    let offset = 0
    let inserted = 0
    let skipped = 0

    while (offset < totalPrices) {
      const prices = await em.find(
        CatalogProductPrice,
        priceFilters,
        { populate: ['priceKind', 'product', 'variant', 'offer'] as never[], limit: batchSize, offset, orderBy: { id: 'ASC' } },
      )
      if (prices.length === 0) break

      const batchPriceIds = prices.map((p) => p.id)
      const existingEntries = await em.find(
        CatalogPriceHistoryEntry,
        { priceId: { $in: batchPriceIds }, organizationId, tenantId },
        { fields: ['priceId'] as never[] },
      )
      const existingPriceIds = new Set(existingEntries.map((e) => e.priceId))

      for (const price of prices) {
        const priceKind = typeof price.priceKind === 'string' ? null : price.priceKind
        if (!priceKind) { skipped++; continue }
        const productId = price.product
          ? (typeof price.product === 'string' ? price.product : price.product.id)
          : price.variant
            ? (typeof price.variant === 'object' && price.variant?.product
                ? (typeof price.variant.product === 'string' ? price.variant.product : price.variant.product.id)
                : null)
            : null
        if (!productId) { skipped++; continue }
        if (existingPriceIds.has(price.id)) { skipped++; continue }

        const snapshot: PriceHistorySnapshot = {
          id: price.id,
          tenantId: price.tenantId,
          organizationId: price.organizationId,
          productId,
          variantId: price.variant ? (typeof price.variant === 'string' ? price.variant : price.variant.id) : null,
          offerId: price.offer ? (typeof price.offer === 'string' ? price.offer : price.offer.id) : null,
          channelId: price.channelId ?? null,
          priceKindId: priceKind.id,
          priceKindCode: priceKind.code,
          currencyCode: price.currencyCode,
          unitPriceNet: price.unitPriceNet ?? null,
          unitPriceGross: price.unitPriceGross ?? null,
          taxRate: price.taxRate ?? null,
          taxAmount: price.taxAmount ?? null,
          minQuantity: price.minQuantity,
          maxQuantity: price.maxQuantity ?? null,
          startsAt: price.startsAt ? price.startsAt.toISOString() : null,
          endsAt: price.endsAt ? price.endsAt.toISOString() : null,
        }
        const fields = buildHistoryEntry({ snapshot, changeType: 'create', source: 'system' })
        em.persist(em.create(CatalogPriceHistoryEntry, { ...fields, recordedAt, idempotencyKey: null }))
        inserted++
      }

      await em.flush()
      offset += prices.length
    }

    return { inserted, skipped }
  }

  private resolveNewArrivalAdjustment(
    channelConfig: OmnibusChannelConfig | undefined,
    ctx: OmnibusResolutionContext,
    lookbackDays: number,
  ): { lookbackDays: number; applicabilityReason: OmnibusApplicabilityReason } | null {
    if (channelConfig?.newArrivalRule !== 'shorter_window') return null
    if (!ctx.firstListedAt) return null
    const now = new Date()
    const productAgeDays = Math.floor((now.getTime() - ctx.firstListedAt.getTime()) / MS_PER_DAY)
    if (productAgeDays >= lookbackDays) return null
    const reducedDays = channelConfig.newArrivalsLookbackDays ?? productAgeDays
    return { lookbackDays: reducedDays > 0 ? reducedDays : 1, applicabilityReason: 'new_arrival_reduced_window' }
  }
}

function buildScopeFilters(ctx: OmnibusResolutionContext): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    tenantId: { $eq: ctx.tenantId },
    organizationId: { $eq: ctx.organizationId },
    priceKindId: { $eq: ctx.priceKindId },
    currencyCode: { $eq: ctx.currencyCode },
  }
  if (ctx.offerId) {
    filters.offerId = { $eq: ctx.offerId }
  }
  // Always scope to the specific variant or product when available,
  // even when an offer ID is also present (an offer can span multiple products).
  if (ctx.variantId) {
    filters.variantId = { $eq: ctx.variantId }
  } else if (ctx.productId) {
    filters.productId = { $eq: ctx.productId }
  }
  if (ctx.channelId) {
    filters.channelId = { $eq: ctx.channelId }
  }
  return filters
}

function buildScopeKey(ctx: OmnibusResolutionContext): string {
  if (ctx.offerId) return `offer:${ctx.offerId}`
  if (ctx.variantId) return `variant:${ctx.variantId}`
  return `product:${ctx.productId}`
}

function mapRow(entry: CatalogPriceHistoryEntry): OmnibusHistoryRow {
  return {
    id: entry.id,
    unitPriceNet: entry.unitPriceNet ?? null,
    unitPriceGross: entry.unitPriceGross ?? null,
    recordedAt: entry.recordedAt.toISOString(),
    startsAt: entry.startsAt?.toISOString() ?? null,
    offerId: entry.offerId ?? null,
    isAnnounced: entry.isAnnounced ?? null,
  }
}

function buildCacheKey(
  ctx: OmnibusResolutionContext,
  axis: string,
  windowStart: Date,
  anchor: Date | null,
): string {
  const windowStartDay = floorToDay(windowStart)
  const anchorDay = anchor ? floorToDay(anchor) : 'none'
  return `omnibus:${ctx.tenantId}:${ctx.organizationId}:${buildScopeKey(ctx)}:${ctx.channelId ?? 'all'}:${ctx.priceKindId}:${ctx.currencyCode}:${axis}:${windowStartDay}:${anchorDay}`
}

function buildCacheTag(ctx: OmnibusResolutionContext): string {
  return `omnibus:${ctx.tenantId}:${ctx.organizationId}:${buildScopeKey(ctx)}:${ctx.channelId ?? 'all'}:${ctx.priceKindId}:${ctx.currencyCode}`
}

function buildEmptyBlock(
  presentedPriceKindId: string,
  currencyCode: string,
  result: OmnibusLowestPriceResult,
  applicabilityReason: OmnibusApplicabilityReason,
): OmnibusBlock {
  return {
    presentedPriceKindId,
    lookbackDays: result.lookbackDays,
    minimizationAxis: result.minimizationAxis,
    promotionAnchorAt: null,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    coverageStartAt: null,
    lowestPriceNet: null,
    lowestPriceGross: null,
    previousPriceNet: null,
    previousPriceGross: null,
    currencyCode,
    applicable: false,
    applicabilityReason,
  }
}

function floorToDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function subtractDays(from: Date, days: number): Date {
  return new Date(from.getTime() - days * MS_PER_DAY)
}

function getPriceValue(row: OmnibusHistoryRow, axis: 'gross' | 'net'): number {
  return parseFloat((axis === 'gross' ? row.unitPriceGross : row.unitPriceNet) ?? 'Infinity')
}

function earlyExitResult(reason: OmnibusApplicabilityReason, lookbackDays: number, axis: 'gross' | 'net'): OmnibusLowestPriceResult {
  const now = new Date()
  const windowStart = subtractDays(now, lookbackDays)
  return {
    lowestRow: null,
    previousRow: null,
    insufficientHistory: false,
    promotionAnchorAt: null,
    coverageStartAt: null,
    applicabilityReason: reason,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    lookbackDays,
    minimizationAxis: axis,
  }
}
