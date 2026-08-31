import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { CacheStrategy } from '@open-mercato/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CatalogPriceHistoryEntry, CatalogProductPrice } from '../data/entities'
import type { OmnibusChannelConfig, OmnibusConfig } from '../data/validators'
import { buildHistoryEntry, buildOmnibusCacheTags, MS_PER_DAY } from '../lib/omnibus'
import { aggregateOmnibusScopes } from './omnibusAggregate'
import type {
  OmnibusAggregateExecutor,
  OmnibusAggregateScope,
  OmnibusScopeAggregate,
} from './omnibusAggregate'
import type { PriceHistorySnapshot } from '../lib/omnibus'
import {
  CATALOG_SETTINGS_MODULE_ID,
  OMNIBUS_CONFIG_KEY,
  OMNIBUS_DEFAULT_LOOKBACK_DAYS,
} from '../lib/settings'
import { OFFERED_CHANGE_TYPES } from '../lib/omnibusTypes'
import type {
  OmnibusApplicabilityReason,
  OmnibusBlock,
  OmnibusHistoryRow,
  OmnibusLowestPriceResult,
  OmnibusMinimizationAxis,
  OmnibusResolutionContext,
} from '../lib/omnibusTypes'

export type {
  OmnibusBlock,
  OmnibusHistoryRow,
  OmnibusLowestPriceResult,
  OmnibusResolutionContext,
}

const logger = createLogger('catalog')

const CACHE_TTL_MS = 5 * 60 * 1000
// Bounds the derogation reads, which still walk rows rather than aggregating them: a long campaign
// on a busy offer would otherwise materialise its whole log on a request path. The standard window
// needs no cap — `aggregateOmnibusScopes` resolves the minimum in SQL and returns three rows.
const DEROGATION_ROW_CAP = 1000
const DEFAULT_PROGRESSIVE_MAX_GAP_DAYS = 7

/**
 * Page-wide history prefetch for the products list.
 *
 * Keyed `productId|priceKindId|currencyCode` — the products-list path resolves product-scoped, so
 * that triple is the whole scope. Each entry is the finished answer for its scope, not the rows it
 * was derived from: one aggregate resolves the whole page, and `computeLowestPrice` runs the same
 * aggregate for a single scope when the page did not prefetch it.
 */
export type OmnibusHistoryPrefetch = {
  byKey: Map<string, OmnibusScopeAggregate>
}

export type OmnibusPrefetchRequest = {
  ctx: OmnibusResolutionContext
  presentedPriceEntry: OmnibusHistoryRow | null
}

export interface BackfillChannelResult {
  inserted: number
  skipped: number
}

export interface CatalogOmnibusService {
  getConfig(scope?: { tenantId?: string | null; organizationId?: string | null }): Promise<OmnibusConfig>
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
    prefetch?: OmnibusHistoryPrefetch,
  ): Promise<OmnibusBlock | null>
  prefetchHistoryForProducts(
    em: EntityManager,
    requests: OmnibusPrefetchRequest[],
  ): Promise<OmnibusHistoryPrefetch>
  resolvePresentedEntryForPrice(
    em: EntityManager,
    scope: { tenantId: string; organizationId: string },
    priceId: string,
  ): Promise<OmnibusHistoryRow | null>
  backfillChannel(
    em: EntityManager,
    params: {
      organizationId: string
      tenantId: string
      channelId: string | null
      lookbackDays: number
      batchSize?: number
    },
  ): Promise<BackfillChannelResult>
}

export class DefaultCatalogOmnibusService implements CatalogOmnibusService {
  // Request-scoped: a products list would otherwise read the config once per row,
  // and concurrent rows all miss together. Storing the promise collapses the burst.
  private readonly configPromises = new Map<string, Promise<OmnibusConfig>>()

  constructor(
    private readonly moduleConfigService: ModuleConfigService,
    private readonly cache: CacheStrategy | null,
    // Substituted only by tests, which have no database to run the aggregate against.
    private readonly aggregate: OmnibusAggregateExecutor = aggregateOmnibusScopes,
  ) {}

  async getConfig(scope?: { tenantId?: string | null; organizationId?: string | null }): Promise<OmnibusConfig> {
    const tenantId = scope?.tenantId ?? null
    const organizationId = scope?.organizationId ?? null
    const key = `${tenantId ?? ''}:${organizationId ?? ''}`
    const pending = this.configPromises.get(key)
    if (pending) return pending

    const promise = this.moduleConfigService
      .getValue<OmnibusConfig>(CATALOG_SETTINGS_MODULE_ID, OMNIBUS_CONFIG_KEY, {
        defaultValue: {},
        scope: { tenantId, organizationId },
      })
      .then((value) => value ?? {})
      .catch((err) => {
        // Never memoise a failure: the next caller must be free to retry.
        this.configPromises.delete(key)
        throw err
      })
    this.configPromises.set(key, promise)
    return promise
  }

  async getLowestPrice(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    presentedPriceEntry?: OmnibusHistoryRow | null,
  ): Promise<OmnibusLowestPriceResult> {
    const config = await this.getConfig({ tenantId: ctx.tenantId, organizationId: ctx.organizationId })
    return this.computeLowestPrice(em, ctx, config, presentedPriceEntry ?? null)
  }

  private async computeLowestPrice(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    config: OmnibusConfig,
    presentedPriceEntry: OmnibusHistoryRow | null,
    prefetch?: OmnibusHistoryPrefetch,
  ): Promise<OmnibusLowestPriceResult> {
    const configuredLookback = config.lookbackDays ?? OMNIBUS_DEFAULT_LOOKBACK_DAYS
    const configuredAxis = config.minimizationAxis ?? 'gross'

    if (!config.enabled) return earlyExitResult('no_history', configuredLookback, configuredAxis)

    const enabledCountryCodes = config.enabledCountryCodes ?? []
    if (enabledCountryCodes.length === 0) {
      return earlyExitResult('not_in_eu_market', configuredLookback, configuredAxis)
    }

    const channelConfig = ctx.channelId ? config.channels?.[ctx.channelId] : undefined

    if (ctx.channelId == null) {
      const mode = ctx.isStorefront === true ? 'require_channel' : (config.noChannelMode ?? 'best_effort')
      if (mode === 'require_channel') {
        return earlyExitResult('missing_channel_context', configuredLookback, configuredAxis)
      }
    } else {
      const countryCode = channelConfig?.countryCode ?? null
      if (countryCode == null || !enabledCountryCodes.includes(countryCode)) {
        return earlyExitResult('not_in_eu_market', configuredLookback, configuredAxis)
      }
    }

    const lookbackDays = channelConfig?.lookbackDays ?? configuredLookback
    const axis: OmnibusMinimizationAxis = channelConfig?.minimizationAxis ?? configuredAxis

    const resolvedOfferId = ctx.offerId ?? presentedPriceEntry?.offerId ?? null
    const firstOfferEntry = resolvedOfferId ? await this.fetchFirstOfferEntry(em, ctx, resolvedOfferId) : null

    if (resolvedOfferId && firstOfferEntry && channelConfig?.progressiveReductionRule === true) {
      const progressive = await this.resolveProgressiveReduction(
        em,
        ctx,
        resolvedOfferId,
        firstOfferEntry,
        channelConfig,
        axis,
        lookbackDays,
      )
      if (progressive) return progressive
    }

    const perishable = await this.resolvePerishableRule(
      em,
      ctx,
      channelConfig,
      lookbackDays,
      axis,
      presentedPriceEntry,
    )
    if (perishable) return perishable

    const newArrival = this.resolveNewArrivalAdjustment(channelConfig, ctx, lookbackDays)
    const effectiveLookbackDays = newArrival?.lookbackDays ?? lookbackDays

    // Anchored so the reference cannot drift on day 31 of a 45-day promotion.
    const anchor = presentedPriceEntry?.startsAt
      ? new Date(presentedPriceEntry.startsAt)
      : firstOfferEntry
        ? new Date(firstOfferEntry.recordedAt)
        : null

    const now = new Date()
    const windowEnd = anchor ?? now
    const windowStart = subtractDays(windowEnd, effectiveLookbackDays)

    const cacheKey = buildCacheKey(ctx, axis, windowStart, anchor, presentedPriceEntry)
    const cached = await this.readCache(cacheKey)
    if (cached) return cached

    // One SQL aggregate answers the scope, whether or not the page prefetched it. Keeping a single
    // code path is the point: the batched and per-scope routes previously diverged on ties, and a
    // divergence here is a wrong legally-binding reference price.
    //
    // EC-7 lives inside that statement: the announced reduction must not become its own reference,
    // enforced by presented-row identity (catches a non-anchored promotion) and the anchor bound
    // (catches the rest). The `change_type` filter is separate and just as load-bearing — `delete`
    // records the value a price held as it was withdrawn, and the undo of a `create` records the
    // value being removed, so both describe prices that were never on offer at that point. Counting
    // them lets a fat-fingered price that was immediately undone become the legal reference for ever.
    const prefetchKey = buildPrefetchKey(ctx)
    const aggregate =
      prefetch?.byKey.get(prefetchKey) ??
      (await this.aggregate(em, { tenantId: ctx.tenantId, organizationId: ctx.organizationId }, axis, [
        buildAggregateScope(prefetchKey, ctx, windowStart, windowEnd, anchor, presentedPriceEntry),
      ])).get(prefetchKey)!

    const lowestRow = aggregate.lowest
    let previousRow: OmnibusHistoryRow | null = null
    let insufficientHistory = false
    let coverageStartAt: string | null = null

    if (lowestRow) {
      if (aggregate.baselineLowest) {
        // Several rows can share the baseline instant; the cheapest is the one that matters,
        // for the same reason the reference itself is a minimum.
        previousRow = aggregate.baselineLowest
      } else {
        previousRow = aggregate.oldest
        insufficientHistory = true
        coverageStartAt = previousRow?.recordedAt ?? null
      }
    }

    const result: OmnibusLowestPriceResult = {
      lowestRow,
      previousRow,
      insufficientHistory,
      promotionAnchorAt: anchor ? anchor.toISOString() : null,
      coverageStartAt,
      applicabilityReason: newArrival?.applicabilityReason,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      lookbackDays: effectiveLookbackDays,
      minimizationAxis: axis,
    }

    await this.writeCache(cacheKey, ctx, result)
    return result
  }

  async resolveOmnibusBlock(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    presentedPriceEntry: OmnibusHistoryRow | null,
    priceKindIsPromotion: boolean,
    prefetch?: OmnibusHistoryPrefetch,
  ): Promise<OmnibusBlock | null> {
    let config: OmnibusConfig
    try {
      config = await this.getConfig({ tenantId: ctx.tenantId, organizationId: ctx.organizationId })
    } catch (err) {
      logger.error('Failed to load Omnibus config', {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        err,
      })
      return null
    }
    if (!config.enabled) return null

    const presentedPriceKindId =
      config.channels?.[ctx.channelId ?? '']?.presentedPriceKindId ??
      config.defaultPresentedPriceKindId ??
      ctx.priceKindId

    let result: OmnibusLowestPriceResult
    try {
      result = await this.computeLowestPrice(em, ctx, config, presentedPriceEntry, prefetch)
    } catch (err) {
      // Price values stay out of the error log on purpose (GDPR caution).
      logger.error('Omnibus resolution failed', {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        variantId: ctx.variantId,
        channelId: ctx.channelId,
        priceKindId: ctx.priceKindId,
        currencyCode: ctx.currencyCode,
        err,
      })
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

    if (result.insufficientHistory) {
      logger.warn('Omnibus reference resolved against incomplete history', {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        channelId: ctx.channelId,
        coverageStartAt: result.coverageStartAt,
        lookbackDays: result.lookbackDays,
      })
    }

    const applicabilityReason: OmnibusApplicabilityReason =
      result.applicabilityReason ??
      (result.insufficientHistory ? 'insufficient_history' : applicable ? 'announced_promotion' : 'not_announced')

    return {
      presentedPriceKindId,
      lookbackDays: result.lookbackDays,
      minimizationAxis: result.minimizationAxis,
      promotionAnchorAt: result.promotionAnchorAt,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      coverageStartAt: result.coverageStartAt,
      // Same row for both: independent minima across mixed tax rates invent a price pair.
      lowestPriceNet: result.lowestRow.unitPriceNet,
      lowestPriceGross: result.lowestRow.unitPriceGross,
      previousPriceNet: result.previousRow?.unitPriceNet ?? null,
      previousPriceGross: result.previousRow?.unitPriceGross ?? null,
      currencyCode: ctx.currencyCode,
      applicable,
      applicabilityReason,
    }
  }

  // For callers holding the exact price row (a sales line at checkout). Passing null here
  // instead lands the reduction inside its own window — EC-7, on legal evidence.
  async resolvePresentedEntryForPrice(
    em: EntityManager,
    scope: { tenantId: string; organizationId: string },
    priceId: string,
  ): Promise<OmnibusHistoryRow | null> {
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, priceId },
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1 },
      scope,
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  private async readCache(key: string): Promise<OmnibusLowestPriceResult | null> {
    if (!this.cache) return null
    const cached = await this.cache.get(key)
    return (cached as OmnibusLowestPriceResult | null) ?? null
  }

  private async writeCache(key: string, ctx: OmnibusResolutionContext, result: OmnibusLowestPriceResult): Promise<void> {
    if (!this.cache) return
    await this.cache.set(key, result, {
      ttl: CACHE_TTL_MS,
      tags: buildOmnibusCacheTags({
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        productId: ctx.productId,
        variantId: ctx.variantId,
      }),
    })
  }

  /**
   * One aggregate for a whole products page instead of a read per row.
   *
   * Each product has its own anchor and its own new-arrival lookback, so each becomes its own row
   * in the aggregate's `scopes` list and the database resolves them together — one statement per
   * distinct minimisation axis for the whole page, rather than one read per product.
   *
   * A scope this cannot answer is simply left out: `resolveWindowFor` declines whenever a
   * derogation, an offer anchor or a gate would take a different path, and `computeLowestPrice`
   * then runs the same aggregate for that one scope. Absence is what keeps the batched and
   * per-scope routes identical — there is no second selection algorithm to keep in step.
   */
  async prefetchHistoryForProducts(
    em: EntityManager,
    requests: OmnibusPrefetchRequest[],
  ): Promise<OmnibusHistoryPrefetch> {
    const empty: OmnibusHistoryPrefetch = { byKey: new Map() }
    if (!requests.length) return empty

    const config = await this.getConfig({
      tenantId: requests[0]!.ctx.tenantId,
      organizationId: requests[0]!.ctx.organizationId,
    })
    if (!config.enabled) return empty

    const scoped = requests
      .map((request) => {
        const window = this.resolveWindowFor(request.ctx, config, request.presentedPriceEntry)
        return window ? { ...request, ...window, key: buildPrefetchKey(request.ctx) } : null
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    if (!scoped.length) return empty

    const { tenantId, organizationId } = requests[0]!.ctx

    // The axis is per-channel configurable, so a page spanning two channels can need both. One
    // statement per distinct axis, which is one in every configuration shipped today.
    const byAxis = new Map<OmnibusMinimizationAxis, OmnibusAggregateScope[]>()
    const seen = new Set<string>()
    for (const entry of scoped) {
      // Two rows of the same page can share a scope; the aggregate answers it once.
      if (seen.has(entry.key)) continue
      seen.add(entry.key)
      const bucket = byAxis.get(entry.axis) ?? []
      bucket.push(
        buildAggregateScope(entry.key, entry.ctx, entry.windowStart, entry.windowEnd, entry.anchor, entry.presentedPriceEntry),
      )
      byAxis.set(entry.axis, bucket)
    }

    const results = await Promise.all(
      Array.from(byAxis.entries()).map(([axis, entries]) =>
        this.aggregate(em, { tenantId, organizationId }, axis, entries),
      ),
    )

    const byKey = new Map<string, OmnibusScopeAggregate>()
    for (const map of results) for (const [key, value] of map) byKey.set(key, value)
    return { byKey }
  }

  /**
   * The window this ctx would resolve to, or null when a derogation or a gate would short-circuit
   * before the standard window is used. Kept beside `computeLowestPrice` so both read the same rules.
   */
  private resolveWindowFor(
    ctx: OmnibusResolutionContext,
    config: OmnibusConfig,
    presentedPriceEntry: OmnibusHistoryRow | null,
  ): { windowStart: Date; windowEnd: Date; anchor: Date | null; axis: OmnibusMinimizationAxis } | null {
    if (!ctx.productId || ctx.variantId || ctx.offerId) return null
    const enabledCountryCodes = config.enabledCountryCodes ?? []
    if (!enabledCountryCodes.length) return null
    const channelConfig = ctx.channelId ? config.channels?.[ctx.channelId] : undefined
    if (ctx.channelId != null) {
      const countryCode = channelConfig?.countryCode ?? null
      if (countryCode == null || !enabledCountryCodes.includes(countryCode)) return null
    } else if (ctx.isStorefront === true || (config.noChannelMode ?? 'best_effort') === 'require_channel') {
      return null
    }
    // A derogation takes its own path and its own reads; leave those to the per-scope resolver.
    if (ctx.omnibusExempt === true && (channelConfig?.perishableGoodsRule ?? 'standard') !== 'standard') return null
    if (presentedPriceEntry?.offerId) return null

    const lookbackDays = channelConfig?.lookbackDays ?? config.lookbackDays ?? OMNIBUS_DEFAULT_LOOKBACK_DAYS
    const newArrival = this.resolveNewArrivalAdjustment(channelConfig, ctx, lookbackDays)
    const effectiveLookbackDays = newArrival?.lookbackDays ?? lookbackDays
    const anchor = presentedPriceEntry?.startsAt ? new Date(presentedPriceEntry.startsAt) : null
    const windowEnd = anchor ?? new Date()
    const axis: OmnibusMinimizationAxis = channelConfig?.minimizationAxis ?? config.minimizationAxis ?? 'gross'
    return { windowStart: subtractDays(windowEnd, effectiveLookbackDays), windowEnd, anchor, axis }
  }

  private async fetchFirstOfferEntry(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    offerId: string,
  ): Promise<OmnibusHistoryRow | null> {
    const filters = buildScopeFilters({ ...ctx, offerId })
    // A backfilled row is a synthetic baseline, not a campaign start, and the backfill copies
    // the offer id onto it. Anchoring to one freezes the window at backfill time and every
    // later real reduction falls outside it.
    filters.source = { $ne: 'system' }
    filters.changeType = { $in: OFFERED_CHANGE_TYPES }
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters,
      { orderBy: { recordedAt: 'ASC', id: 'ASC' }, limit: 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  // Art. 6a(5): a continuous campaign of deepening discounts keeps the price from BEFORE the
  // first reduction as its reference, instead of a recalculated rolling minimum.
  private async resolveProgressiveReduction(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    offerId: string,
    firstOfferEntry: OmnibusHistoryRow,
    channelConfig: OmnibusChannelConfig,
    axis: OmnibusMinimizationAxis,
    lookbackDays: number,
  ): Promise<OmnibusLowestPriceResult | null> {
    const campaignFilters = buildScopeFilters({ ...ctx, offerId })
    // A withdrawal or an undo is not a campaign step; counting one as a reduction would let a
    // monotonic campaign look broken, or a broken one look monotonic.
    campaignFilters.changeType = { $in: OFFERED_CHANGE_TYPES }
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      campaignFilters,
      // Bounded like every other history read: a long campaign on a busy offer would otherwise
      // materialise its whole log on a request path.
      { orderBy: { recordedAt: 'ASC', id: 'ASC' }, limit: DEROGATION_ROW_CAP },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const entries = rows.map(mapRow)
    if (entries.length < 2) return null

    const maxGapMs = (channelConfig.progressiveMaxGapDays ?? DEFAULT_PROGRESSIVE_MAX_GAP_DAYS) * MS_PER_DAY
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1]!
      const current = entries[index]!
      if (getPriceValue(current, axis) > getPriceValue(previous, axis)) return null
      const gapMs = new Date(current.recordedAt).getTime() - new Date(previous.recordedAt).getTime()
      if (gapMs > maxGapMs) return null
    }

    const preCampaignFilters = buildScopeFilters({ ...ctx, offerId: undefined })
    preCampaignFilters.offerId = null
    preCampaignFilters.changeType = { $in: OFFERED_CHANGE_TYPES }
    preCampaignFilters.recordedAt = { $lt: new Date(firstOfferEntry.recordedAt) }
    const baselineRows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      preCampaignFilters,
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const baselineRow = baselineRows[0] ? mapRow(baselineRows[0]) : null
    // Nothing to freeze to; fall through rather than invent a reference.
    if (!baselineRow) return null

    const now = new Date()
    return {
      lowestRow: baselineRow,
      previousRow: entries[entries.length - 1]!,
      insufficientHistory: false,
      promotionAnchorAt: new Date(firstOfferEntry.recordedAt).toISOString(),
      coverageStartAt: null,
      applicabilityReason: 'progressive_reduction_frozen',
      windowStart: subtractDays(now, lookbackDays).toISOString(),
      windowEnd: now.toISOString(),
      lookbackDays,
      minimizationAxis: axis,
    }
  }

  // Art. 6a(3): member states may treat goods that deteriorate or expire rapidly differently.
  private async resolvePerishableRule(
    em: EntityManager,
    ctx: OmnibusResolutionContext,
    channelConfig: OmnibusChannelConfig | undefined,
    lookbackDays: number,
    axis: OmnibusMinimizationAxis,
    presentedPriceEntry: OmnibusHistoryRow | null,
  ): Promise<OmnibusLowestPriceResult | null> {
    const rule = channelConfig?.perishableGoodsRule ?? 'standard'
    if (ctx.omnibusExempt !== true || rule === 'standard') return null

    if (rule === 'exempt') return earlyExitResult('perishable_exempt', lookbackDays, axis)

    // "Immediately preceding the reduction" bounds this by the presented entry, not `now`:
    // that entry is normally the newest row, so without the bound it becomes its own reference.
    const filters = buildScopeFilters(ctx)
    // Same rule as the standard path: a withdrawn or undone price was never on offer, so it cannot
    // be "the price immediately preceding the reduction" either.
    filters.changeType = { $in: OFFERED_CHANGE_TYPES }
    if (presentedPriceEntry) {
      filters.recordedAt = { $lt: new Date(presentedPriceEntry.recordedAt) }
    }
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters,
      // Two rows so a same-instant tie can still be skipped by identity.
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 2 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const lastEntry = rows.map(mapRow).find((row) => !isPresentedReduction(row, presentedPriceEntry)) ?? null
    if (!lastEntry) return null
    const now = new Date()
    return {
      lowestRow: lastEntry,
      previousRow: lastEntry,
      insufficientHistory: false,
      promotionAnchorAt: null,
      coverageStartAt: null,
      applicabilityReason: 'perishable_last_price',
      windowStart: subtractDays(now, lookbackDays).toISOString(),
      windowEnd: now.toISOString(),
      lookbackDays,
      minimizationAxis: axis,
    }
  }

  // Art. 6a(4): a product on the market for less than the lookback may use a shorter period.
  private resolveNewArrivalAdjustment(
    channelConfig: OmnibusChannelConfig | undefined,
    ctx: OmnibusResolutionContext,
    lookbackDays: number,
  ): { lookbackDays: number; applicabilityReason: OmnibusApplicabilityReason } | null {
    if (channelConfig?.newArrivalRule !== 'shorter_window') return null
    if (!ctx.firstListedAt) return null
    const productAgeDays = Math.floor((Date.now() - ctx.firstListedAt.getTime()) / MS_PER_DAY)
    if (productAgeDays >= lookbackDays) return null
    const reducedDays = channelConfig.newArrivalsLookbackDays ?? productAgeDays
    return {
      lookbackDays: reducedDays > 0 ? reducedDays : 1,
      applicabilityReason: 'new_arrival_reduced_window',
    }
  }

  async backfillChannel(
    em: EntityManager,
    params: {
      organizationId: string
      tenantId: string
      channelId: string | null
      lookbackDays: number
      batchSize?: number
    },
  ): Promise<BackfillChannelResult> {
    const { organizationId, tenantId, channelId, lookbackDays, batchSize = 500 } = params
    const scope = { tenantId, organizationId }
    // Owned fork: a full-catalog run would otherwise hold every seeded row in the caller
    // identity map, and clearing a shared EM would detach entities the caller still holds.
    const scopedEm = em.fork()
    // One ms before the window opens, so the row reads as the price already in effect.
    const recordedAt = new Date(Date.now() - lookbackDays * MS_PER_DAY - 1)

    const priceFilters: Record<string, unknown> = { organizationId, tenantId }
    if (channelId) priceFilters.channelId = channelId

    let offset = 0
    let inserted = 0
    let skipped = 0

    for (;;) {
      const prices = await findWithDecryption(
        scopedEm,
        CatalogProductPrice,
        priceFilters,
        {
          populate: ['priceKind', 'product', 'variant', 'offer'] as never[],
          limit: batchSize,
          offset,
          orderBy: { id: 'ASC' },
        },
        scope,
      )
      if (prices.length === 0) break

      const existing = await findWithDecryption(
        scopedEm,
        CatalogPriceHistoryEntry,
        { priceId: { $in: prices.map((price) => price.id) }, organizationId, tenantId },
        { fields: ['priceId'] as never[] },
        scope,
      )
      const alreadyRecorded = new Set(existing.map((entry) => entry.priceId))

      for (const price of prices) {
        const priceKind = typeof price.priceKind === 'string' ? null : price.priceKind
        const productId = resolvePriceProductId(price)
        if (!priceKind || !productId || alreadyRecorded.has(price.id)) {
          skipped += 1
          continue
        }

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
        const fields = buildHistoryEntry({ snapshot, changeType: 'create', source: 'system', recordedAt })
        scopedEm.persist(scopedEm.create(CatalogPriceHistoryEntry, { ...fields, idempotencyKey: null }))
        inserted += 1
      }

      await scopedEm.flush()
      scopedEm.clear()
      offset += prices.length
    }

    return { inserted, skipped }
  }
}

function resolvePriceProductId(price: CatalogProductPrice): string | null {
  if (price.product) return typeof price.product === 'string' ? price.product : price.product.id
  if (price.variant && typeof price.variant === 'object' && price.variant.product) {
    return typeof price.variant.product === 'string' ? price.variant.product : price.variant.product.id
  }
  return null
}

/**
 * Translate a resolution context into the aggregate's scope shape. `variantId` narrows instead of
 * `productId` rather than alongside it, matching buildScopeFilters — an offer can span products, so
 * the narrower of the two is the whole scope.
 */
function buildAggregateScope(
  key: string,
  ctx: OmnibusResolutionContext,
  windowStart: Date,
  windowEnd: Date,
  anchor: Date | null,
  presented: OmnibusHistoryRow | null,
): OmnibusAggregateScope {
  return {
    key,
    offerId: ctx.offerId ?? null,
    variantId: ctx.variantId ?? null,
    productId: ctx.variantId ? null : (ctx.productId ?? null),
    priceKindId: ctx.priceKindId,
    currencyCode: ctx.currencyCode,
    channelId: ctx.channelId ?? null,
    windowStart,
    windowEnd,
    anchor,
    presented,
  }
}

/**
 * Identity of a resolution scope. Exported because it is the key of `OmnibusHistoryPrefetch.byKey`,
 * so anything reading that map needs it — the format itself is not a contract.
 *
 * Every dimension `buildAggregateScope` narrows on is in here. That is not decoration: a lookup
 * that hits an entry answering a *different* scope returns a reference price resolved from the
 * wrong rows, and it does so silently. Product-scoped and variant-scoped resolutions of the same
 * product previously produced the same key, and only the fact that the one caller passing a
 * prefetch never resolves variant-scoped kept them apart.
 */
export function buildPrefetchKey(ctx: OmnibusResolutionContext): string {
  return [
    ctx.productId ?? '',
    ctx.variantId ?? '',
    ctx.offerId ?? '',
    ctx.channelId ?? '',
    ctx.priceKindId,
    ctx.currencyCode,
  ].join('|')
}


function isPresentedReduction(row: OmnibusHistoryRow, presented: OmnibusHistoryRow | null): boolean {
  if (!presented) return false
  return (
    row.priceId === presented.priceId &&
    row.changeType === presented.changeType &&
    row.recordedAt === presented.recordedAt
  )
}

function buildScopeFilters(ctx: OmnibusResolutionContext): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    tenantId: { $eq: ctx.tenantId },
    organizationId: { $eq: ctx.organizationId },
    priceKindId: { $eq: ctx.priceKindId },
    currencyCode: { $eq: ctx.currencyCode },
  }
  if (ctx.offerId) filters.offerId = { $eq: ctx.offerId }
  // Narrow even with an offer present: an offer can span products.
  if (ctx.variantId) filters.variantId = { $eq: ctx.variantId }
  else if (ctx.productId) filters.productId = { $eq: ctx.productId }
  if (ctx.channelId) filters.channelId = { $eq: ctx.channelId }
  return filters
}

function buildScopeKey(ctx: OmnibusResolutionContext): string {
  if (ctx.offerId) return `offer:${ctx.offerId}`
  if (ctx.variantId) return `variant:${ctx.variantId}`
  return `product:${ctx.productId ?? 'none'}`
}

function mapRow(entry: CatalogPriceHistoryEntry): OmnibusHistoryRow {
  return {
    id: entry.id,
    priceId: entry.priceId,
    changeType: entry.changeType,
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
  axis: OmnibusMinimizationAxis,
  windowStart: Date,
  anchor: Date | null,
  presentedPriceEntry: OmnibusHistoryRow | null,
): string {
  // Anchor day separates anchored from sliding windows; presented identity separates two
  // reductions, which exclude different rows from their candidate sets.
  const anchorDay = anchor ? floorToDay(anchor) : 'none'
  const presented = presentedPriceEntry
    ? `${presentedPriceEntry.priceId}:${presentedPriceEntry.changeType}:${presentedPriceEntry.recordedAt}`
    : 'none'
  return [
    'omnibus',
    ctx.tenantId,
    ctx.organizationId,
    buildScopeKey(ctx),
    ctx.channelId ?? 'all',
    ctx.priceKindId,
    ctx.currencyCode,
    axis,
    floorToDay(windowStart),
    anchorDay,
    presented,
  ].join(':')
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
    // The anchor that actually shaped the window; null here contradicts windowEnd.
    promotionAnchorAt: result.promotionAnchorAt,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    coverageStartAt: result.coverageStartAt,
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

function getPriceValue(row: OmnibusHistoryRow, axis: OmnibusMinimizationAxis): number {
  const raw = axis === 'gross' ? row.unitPriceGross : row.unitPriceNet
  if (raw == null) return Number.POSITIVE_INFINITY
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function earlyExitResult(
  reason: OmnibusApplicabilityReason,
  lookbackDays: number,
  axis: OmnibusMinimizationAxis,
): OmnibusLowestPriceResult {
  const now = new Date()
  return {
    lowestRow: null,
    previousRow: null,
    insufficientHistory: false,
    promotionAnchorAt: null,
    coverageStartAt: null,
    applicabilityReason: reason,
    windowStart: subtractDays(now, lookbackDays).toISOString(),
    windowEnd: now.toISOString(),
    lookbackDays,
    minimizationAxis: axis,
  }
}
