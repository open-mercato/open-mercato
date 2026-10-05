import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CatalogPriceHistoryEntry } from '../data/entities'
import {
  OMNIBUS_CONFIG_MODULE_ID,
  OMNIBUS_CONFIG_NAME,
  OMNIBUS_DEFAULT_LOOKBACK_DAYS,
  omnibusConfigSchema,
  type OmnibusApplicabilityReason,
  type OmnibusBlock,
  type OmnibusConfig,
  type OmnibusHistoryRow,
  type OmnibusLowestPriceResult,
  type OmnibusMinimizationAxis,
  type OmnibusPresentedEntry,
  type OmnibusResolutionContext,
  type OmnibusResolutionRequest,
} from '../lib/omnibusTypes'
import {
  buildOmnibusCacheKey,
  buildOmnibusCacheTags,
  readOmnibusCache,
  writeOmnibusCache,
} from '../lib/omnibusCache'
import {
  fetchOmnibusFirstOfferIds,
  fetchOmnibusWindowIds,
  type OmnibusFirstOfferLookup,
  type OmnibusScopeColumn,
  type OmnibusWindowLookup,
} from '../lib/omnibusHistoryQueries'
import { formatFixedDecimal4 } from '../lib/priceHistoryQuery'

const logger = createLogger('catalog')

const DAY_MS = 24 * 60 * 60 * 1000

const DECIMAL_SCALE = 4

export type OmnibusConfigScope = {
  tenantId: string
  organizationId?: string | null
}

export interface CatalogOmnibusService {
  getConfig(scope: OmnibusConfigScope): Promise<OmnibusConfig | null>
  resolvePresentedPriceKindId(
    config: OmnibusConfig,
    channelId: string | null | undefined,
    fallbackPriceKindId?: string | null,
  ): string | null
  computeLowestPrice(
    em: EntityManager,
    context: OmnibusResolutionContext,
    config: OmnibusConfig,
    presentedEntry?: OmnibusPresentedEntry | null,
  ): Promise<OmnibusLowestPriceResult>
  computeLowestPrices(
    em: EntityManager,
    entries: Array<{ context: OmnibusResolutionContext; config: OmnibusConfig; presentedEntry?: OmnibusPresentedEntry | null }>,
  ): Promise<OmnibusLowestPriceResult[]>
  resolveOmnibusBlock(
    em: EntityManager,
    context: OmnibusResolutionContext,
    presentedEntry?: OmnibusPresentedEntry | null,
    priceKindIsPromotion?: boolean,
  ): Promise<OmnibusBlock | null>
  resolveOmnibusBlocks(em: EntityManager, requests: OmnibusResolutionRequest[]): Promise<Array<OmnibusBlock | null>>
}

type HistoryScope = { column: OmnibusScopeColumn; id: string }

type PreparedLookup = {
  index: number
  context: OmnibusResolutionContext
  presentedEntry: OmnibusPresentedEntry | null
  presentedPriceKindId: string
  scope: HistoryScope
  channelId: string | null
  lookbackDays: number
  axis: OmnibusMinimizationAxis
  offerId: string | null
  anchor: Date | null
  now: Date
}

type WindowedLookup = PreparedLookup & {
  windowStart: Date
  windowEnd: Date
  cacheKey: string
}

type CachedFirstOffer = { recordedAt: string | null }

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function truncToUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseScaledDecimal(value: string | null): bigint | null {
  if (value === null) return null
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (!match) return null
  const [, sign, whole, fraction = ''] = match
  const scaled = BigInt(`${whole}${fraction.slice(0, DECIMAL_SCALE).padEnd(DECIMAL_SCALE, '0')}`)
  return sign === '-' ? -scaled : scaled
}

function priceValue(row: OmnibusHistoryRow, axis: OmnibusMinimizationAxis): bigint | null {
  return parseScaledDecimal(axis === 'gross' ? row.unitPriceGross : row.unitPriceNet)
}

function compareChronological(left: OmnibusHistoryRow, right: OmnibusHistoryRow): number {
  const delta = Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
  if (delta !== 0) return delta
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function compareByAxis(left: OmnibusHistoryRow, right: OmnibusHistoryRow, axis: OmnibusMinimizationAxis): number {
  const leftValue = priceValue(left, axis)
  const rightValue = priceValue(right, axis)
  if (leftValue === null && rightValue !== null) return 1
  if (leftValue !== null && rightValue === null) return -1
  if (leftValue !== null && rightValue !== null && leftValue !== rightValue) return leftValue < rightValue ? -1 : 1
  return compareChronological(left, right)
}

function isPresentedReduction(row: OmnibusHistoryRow, presented: OmnibusPresentedEntry | null): boolean {
  if (!presented) return false
  const presentedAt = toDate(presented.recordedAt)
  return (
    row.priceId === presented.priceId &&
    row.changeType === presented.changeType &&
    presentedAt !== null &&
    Date.parse(row.recordedAt) === presentedAt.getTime()
  )
}

export type OmnibusCandidateSelection = {
  lowestRow: OmnibusHistoryRow | null
  previousRow: OmnibusHistoryRow | null
  insufficientHistory: boolean
  coverageStartAt: string | null
}

export function selectOmnibusCandidates(input: {
  baseline: OmnibusHistoryRow | null
  inWindow: OmnibusHistoryRow[]
  presentedEntry: OmnibusPresentedEntry | null
  anchor: Date | null
  axis: OmnibusMinimizationAxis
}): OmnibusCandidateSelection {
  const anchorMs = input.anchor ? input.anchor.getTime() : null
  const pool = input.baseline ? [input.baseline, ...input.inWindow] : [...input.inWindow]
  const candidates = pool.filter(
    (row) =>
      !isPresentedReduction(row, input.presentedEntry) && (anchorMs === null || Date.parse(row.recordedAt) < anchorMs),
  )
  if (!candidates.length) {
    return { lowestRow: null, previousRow: null, insufficientHistory: false, coverageStartAt: null }
  }
  const lowest = [...candidates].sort((left, right) => compareByAxis(left, right, input.axis))[0]
  const lowestRow = priceValue(lowest, input.axis) === null ? null : lowest
  const baselineKept = input.baseline !== null && candidates.includes(input.baseline)
  if (baselineKept) {
    return { lowestRow, previousRow: input.baseline, insufficientHistory: false, coverageStartAt: null }
  }
  const oldest = [...candidates].sort(compareChronological)[0]
  return { lowestRow, previousRow: oldest, insufficientHistory: true, coverageStartAt: oldest.recordedAt }
}

function toHistoryRow(entry: CatalogPriceHistoryEntry): OmnibusHistoryRow {
  const recordedAt = entry.recordedAt instanceof Date ? entry.recordedAt : new Date(entry.recordedAt)
  return {
    id: entry.id,
    priceId: entry.priceId,
    changeType: entry.changeType,
    recordedAt: recordedAt.toISOString(),
    unitPriceNet: entry.unitPriceNet ?? null,
    unitPriceGross: entry.unitPriceGross ?? null,
  }
}

function resolveHistoryScope(context: OmnibusResolutionContext): HistoryScope | null {
  if (context.offerId) return { column: 'offer_id', id: context.offerId }
  if (context.variantId) return { column: 'variant_id', id: context.variantId }
  if (context.productId) return { column: 'product_id', id: context.productId }
  return null
}

function earlyResult(
  reason: OmnibusApplicabilityReason,
  presentedPriceKindId: string | null,
  lookbackDays: number,
  axis: OmnibusMinimizationAxis,
): OmnibusLowestPriceResult {
  return {
    reason,
    presentedPriceKindId,
    lowestRow: null,
    previousRow: null,
    insufficientHistory: false,
    promotionAnchorAt: null,
    coverageStartAt: null,
    windowStart: null,
    windowEnd: null,
    lookbackDays,
    minimizationAxis: axis,
  }
}

function emptyBlock(result: OmnibusLowestPriceResult, currencyCode: string, reason: OmnibusApplicabilityReason): OmnibusBlock {
  return {
    presentedPriceKindId: result.presentedPriceKindId,
    lookbackDays: result.lookbackDays,
    minimizationAxis: result.minimizationAxis,
    promotionAnchorAt: result.promotionAnchorAt,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    coverageStartAt: null,
    lowestPriceNet: null,
    lowestPriceGross: null,
    previousPriceNet: null,
    previousPriceGross: null,
    currencyCode,
    applicable: false,
    applicabilityReason: reason,
  }
}

export function buildOmnibusBlock(
  result: OmnibusLowestPriceResult,
  context: OmnibusResolutionContext,
  presentedEntry: OmnibusPresentedEntry | null,
  priceKindIsPromotion: boolean,
): OmnibusBlock {
  if (result.reason === 'not_in_eu_market' || result.reason === 'missing_channel_context') {
    return emptyBlock(result, context.currencyCode, result.reason)
  }
  if (!result.lowestRow) return emptyBlock(result, context.currencyCode, result.reason ?? 'no_history')
  const applicable =
    Boolean(presentedEntry?.startsAt) ||
    Boolean(presentedEntry?.offerId) ||
    presentedEntry?.isAnnounced === true ||
    priceKindIsPromotion
  const reason: OmnibusApplicabilityReason =
    result.reason ?? (result.insufficientHistory ? 'insufficient_history' : applicable ? 'announced_promotion' : 'not_announced')
  return {
    presentedPriceKindId: result.presentedPriceKindId,
    lookbackDays: result.lookbackDays,
    minimizationAxis: result.minimizationAxis,
    promotionAnchorAt: result.promotionAnchorAt,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    coverageStartAt: result.coverageStartAt,
    lowestPriceNet: formatFixedDecimal4(result.lowestRow.unitPriceNet),
    lowestPriceGross: formatFixedDecimal4(result.lowestRow.unitPriceGross),
    previousPriceNet: formatFixedDecimal4(result.previousRow?.unitPriceNet ?? null),
    previousPriceGross: formatFixedDecimal4(result.previousRow?.unitPriceGross ?? null),
    currencyCode: context.currencyCode,
    applicable,
    applicabilityReason: reason,
  }
}

function presentedIdentity(presented: OmnibusPresentedEntry | null): string {
  if (!presented) return 'none'
  const recordedAt = toDate(presented.recordedAt)
  return `${presented.priceId}|${presented.changeType}|${recordedAt ? recordedAt.toISOString() : 'invalid'}`
}

function scopeTargets(context: OmnibusResolutionContext) {
  return { productId: context.productId ?? null, variantId: context.variantId ?? null, offerId: context.offerId ?? null }
}

export class DefaultCatalogOmnibusService implements CatalogOmnibusService {
  constructor(
    private readonly moduleConfigService: ModuleConfigService | null,
    private readonly cache: CacheStrategy | null,
  ) {}

  async getConfig(scope: OmnibusConfigScope): Promise<OmnibusConfig | null> {
    if (!this.moduleConfigService) return null
    const raw = await this.moduleConfigService.getValue<unknown>(OMNIBUS_CONFIG_MODULE_ID, OMNIBUS_CONFIG_NAME, {
      scope: { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
    })
    if (raw === null || raw === undefined) return null
    const parsed = omnibusConfigSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn('[internal] catalog omnibus config is invalid; treating omnibus as disabled', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId ?? null,
        issues: parsed.error.issues.map((issue) => issue.path.join('.')),
      })
      return null
    }
    return parsed.data
  }

  resolvePresentedPriceKindId(
    config: OmnibusConfig,
    channelId: string | null | undefined,
    fallbackPriceKindId?: string | null,
  ): string | null {
    const channelConfig = channelId ? config.channels[channelId] : undefined
    return channelConfig?.presentedPriceKindId ?? config.defaultPresentedPriceKindId ?? fallbackPriceKindId ?? null
  }

  async computeLowestPrice(
    em: EntityManager,
    context: OmnibusResolutionContext,
    config: OmnibusConfig,
    presentedEntry: OmnibusPresentedEntry | null = null,
  ): Promise<OmnibusLowestPriceResult> {
    const [result] = await this.computeLowestPrices(em, [{ context, config, presentedEntry }])
    return result
  }

  async computeLowestPrices(
    em: EntityManager,
    entries: Array<{ context: OmnibusResolutionContext; config: OmnibusConfig; presentedEntry?: OmnibusPresentedEntry | null }>,
  ): Promise<OmnibusLowestPriceResult[]> {
    const results: Array<OmnibusLowestPriceResult | null> = entries.map(() => null)
    const prepared: PreparedLookup[] = []
    entries.forEach((entry, index) => {
      const gated = this.prepareLookup(index, entry.context, entry.config, entry.presentedEntry ?? null)
      if ('reason' in gated) results[index] = gated
      else prepared.push(gated)
    })
    await this.resolveOfferAnchors(em, prepared)
    const windowed = prepared.map((lookup) => this.applyWindow(lookup))
    const pending: WindowedLookup[] = []
    for (const lookup of windowed) {
      const cached = await readOmnibusCache<OmnibusLowestPriceResult>(this.cache, lookup.context.tenantId, lookup.cacheKey)
      if (cached) results[lookup.index] = cached
      else pending.push(lookup)
    }
    if (pending.length) {
      const computed = await this.computeFromHistory(em, pending)
      for (let position = 0; position < pending.length; position += 1) {
        const lookup = pending[position]
        const result = computed[position]
        results[lookup.index] = result
        await writeOmnibusCache(
          this.cache,
          lookup.context.tenantId,
          lookup.cacheKey,
          result,
          buildOmnibusCacheTags(lookup.context, scopeTargets(lookup.context)),
        )
      }
    }
    return results.map((result, index) => {
      if (result) return result
      const entry = entries[index]
      return earlyResult('no_history', null, entry.config.lookbackDays, entry.config.minimizationAxis)
    })
  }

  async resolveOmnibusBlock(
    em: EntityManager,
    context: OmnibusResolutionContext,
    presentedEntry: OmnibusPresentedEntry | null = null,
    priceKindIsPromotion = false,
  ): Promise<OmnibusBlock | null> {
    const [block] = await this.resolveOmnibusBlocks(em, [{ context, presentedEntry, priceKindIsPromotion }])
    return block ?? null
  }

  async resolveOmnibusBlocks(em: EntityManager, requests: OmnibusResolutionRequest[]): Promise<Array<OmnibusBlock | null>> {
    const blocks: Array<OmnibusBlock | null> = requests.map(() => null)
    if (!requests.length) return blocks
    const configs = await this.loadConfigs(requests)
    const enabled: Array<{ index: number; config: OmnibusConfig }> = []
    requests.forEach((request, index) => {
      const config = configs.get(configKey(request.context)) ?? null
      if (config && config.enabled === true) enabled.push({ index, config })
    })
    if (!enabled.length) return blocks
    try {
      const results = await this.computeLowestPrices(
        em,
        enabled.map(({ index, config }) => ({
          context: requests[index].context,
          config,
          presentedEntry: requests[index].presentedEntry ?? null,
        })),
      )
      enabled.forEach(({ index }, position) => {
        const request = requests[index]
        blocks[index] = buildOmnibusBlock(
          results[position],
          request.context,
          request.presentedEntry ?? null,
          request.priceKindIsPromotion === true,
        )
      })
    } catch (err) {
      const first = requests[enabled[0].index].context
      logger.error('[internal] catalog omnibus resolution failed', {
        tenantId: first.tenantId,
        organizationId: first.organizationId,
        channelId: first.channelId ?? null,
        priceKindId: first.priceKindId ?? null,
        currencyCode: first.currencyCode,
        requestCount: enabled.length,
        err,
      })
      getTelemetryRuntime()?.reportError(err, {
        module: 'catalog',
        code: 'catalog.omnibus_resolution_failed',
        attributes: { requestCount: enabled.length },
      })
      return requests.map(() => null)
    }
    return blocks
  }

  private async loadConfigs(requests: OmnibusResolutionRequest[]): Promise<Map<string, OmnibusConfig | null>> {
    const configs = new Map<string, OmnibusConfig | null>()
    for (const request of requests) {
      const key = configKey(request.context)
      if (configs.has(key)) continue
      configs.set(
        key,
        await this.getConfig({ tenantId: request.context.tenantId, organizationId: request.context.organizationId }),
      )
    }
    return configs
  }

  private prepareLookup(
    index: number,
    context: OmnibusResolutionContext,
    config: OmnibusConfig,
    presentedEntry: OmnibusPresentedEntry | null,
  ): PreparedLookup | OmnibusLowestPriceResult {
    const channelId = context.channelId ?? null
    const channelConfig = channelId ? config.channels[channelId] : undefined
    const lookbackDays = channelConfig?.lookbackDays ?? config.lookbackDays ?? OMNIBUS_DEFAULT_LOOKBACK_DAYS
    const axis = channelConfig?.minimizationAxis ?? config.minimizationAxis ?? 'gross'
    const presentedPriceKindId = this.resolvePresentedPriceKindId(config, channelId, context.priceKindId)
    if (config.enabled !== true) return earlyResult('no_history', presentedPriceKindId, lookbackDays, axis)
    const codes = config.enabledCountryCodes ?? []
    if (!codes.length) return earlyResult('not_in_eu_market', presentedPriceKindId, lookbackDays, axis)
    if (!channelId) {
      const mode = context.isStorefront === true ? 'require_channel' : config.noChannelMode ?? 'best_effort'
      if (mode === 'require_channel') {
        return earlyResult('missing_channel_context', presentedPriceKindId, lookbackDays, axis)
      }
    } else {
      const countryCode = channelConfig?.countryCode
      if (!countryCode || !codes.includes(countryCode)) {
        return earlyResult('not_in_eu_market', presentedPriceKindId, lookbackDays, axis)
      }
    }
    const scope = resolveHistoryScope(context)
    if (!scope || !presentedPriceKindId) return earlyResult('no_history', presentedPriceKindId, lookbackDays, axis)
    return {
      index,
      context,
      presentedEntry,
      presentedPriceKindId,
      scope,
      channelId,
      lookbackDays,
      axis,
      offerId: context.offerId ?? presentedEntry?.offerId ?? null,
      anchor: toDate(presentedEntry?.startsAt ?? null),
      now: context.now ?? new Date(),
    }
  }

  private async resolveOfferAnchors(em: EntityManager, prepared: PreparedLookup[]): Promise<void> {
    const needing = prepared.filter((lookup) => lookup.anchor === null && lookup.offerId !== null)
    if (!needing.length) return
    const misses: Array<{ lookup: PreparedLookup; key: string }> = []
    for (const lookup of needing) {
      const key = firstOfferCacheKey(lookup)
      const cached = await readOmnibusCache<CachedFirstOffer>(this.cache, lookup.context.tenantId, key)
      if (cached) lookup.anchor = toDate(cached.recordedAt)
      else misses.push({ lookup, key })
    }
    if (!misses.length) return
    const offerLookups: OmnibusFirstOfferLookup[] = misses.map(({ lookup }) => ({
      tenantId: lookup.context.tenantId,
      organizationId: lookup.context.organizationId,
      offerId: lookup.offerId as string,
      priceKindId: lookup.presentedPriceKindId,
      currencyCode: lookup.context.currencyCode,
      channelId: lookup.channelId,
    }))
    const ids = await fetchOmnibusFirstOfferIds(em, offerLookups)
    const rows = await this.hydrate(em, misses.map(({ lookup }) => lookup.context), ids.filter(isPresent))
    for (let position = 0; position < misses.length; position += 1) {
      const { lookup, key } = misses[position]
      const id = ids[position]
      const row = id ? rows.get(id) ?? null : null
      lookup.anchor = row ? new Date(row.recordedAt) : null
      await writeOmnibusCache(
        this.cache,
        lookup.context.tenantId,
        key,
        { recordedAt: row ? row.recordedAt : null } satisfies CachedFirstOffer,
        buildOmnibusCacheTags(lookup.context, { ...scopeTargets(lookup.context), offerId: lookup.offerId }),
      )
    }
  }

  private applyWindow(lookup: PreparedLookup): WindowedLookup {
    const windowEnd = lookup.anchor ?? lookup.now
    const windowStart = new Date(windowEnd.getTime() - lookup.lookbackDays * DAY_MS)
    const cacheKey = buildOmnibusCacheKey('lowest', [
      lookup.context.tenantId,
      lookup.context.organizationId,
      `${lookup.scope.column}=${lookup.scope.id}`,
      lookup.channelId ?? 'none',
      lookup.presentedPriceKindId,
      lookup.context.currencyCode,
      lookup.axis,
      lookup.lookbackDays,
      truncToUtcDay(windowStart),
      lookup.anchor ? truncToUtcDay(lookup.anchor) : 'none',
      lookup.anchor ? lookup.anchor.toISOString() : 'sliding',
      presentedIdentity(lookup.presentedEntry),
    ])
    return { ...lookup, windowStart, windowEnd, cacheKey }
  }

  private async computeFromHistory(em: EntityManager, lookups: WindowedLookup[]): Promise<OmnibusLowestPriceResult[]> {
    const windowLookups: OmnibusWindowLookup[] = lookups.map((lookup) => ({
      tenantId: lookup.context.tenantId,
      organizationId: lookup.context.organizationId,
      scopeColumn: lookup.scope.column,
      scopeId: lookup.scope.id,
      priceKindId: lookup.presentedPriceKindId,
      currencyCode: lookup.context.currencyCode,
      channelId: lookup.channelId,
      windowStart: lookup.windowStart,
      windowEnd: lookup.windowEnd,
    }))
    const idSets = await fetchOmnibusWindowIds(em, windowLookups)
    const allIds = new Set<string>()
    for (const set of idSets) {
      if (set.baselineId) allIds.add(set.baselineId)
      for (const id of set.inWindowIds) allIds.add(id)
    }
    const rows = await this.hydrate(em, lookups.map((lookup) => lookup.context), Array.from(allIds))
    return lookups.map((lookup, position) => {
      const set = idSets[position]
      const baseline = set.baselineId ? rows.get(set.baselineId) ?? null : null
      const inWindow = set.inWindowIds.map((id) => rows.get(id)).filter(isPresent)
      const selection = selectOmnibusCandidates({
        baseline,
        inWindow,
        presentedEntry: lookup.presentedEntry,
        anchor: lookup.anchor,
        axis: lookup.axis,
      })
      return {
        reason: null,
        presentedPriceKindId: lookup.presentedPriceKindId,
        lowestRow: selection.lowestRow,
        previousRow: selection.previousRow,
        insufficientHistory: selection.insufficientHistory,
        promotionAnchorAt: lookup.anchor ? lookup.anchor.toISOString() : null,
        coverageStartAt: selection.coverageStartAt,
        windowStart: lookup.windowStart.toISOString(),
        windowEnd: lookup.windowEnd.toISOString(),
        lookbackDays: lookup.lookbackDays,
        minimizationAxis: lookup.axis,
      }
    })
  }

  private async hydrate(
    em: EntityManager,
    contexts: OmnibusResolutionContext[],
    ids: string[],
  ): Promise<Map<string, OmnibusHistoryRow>> {
    const rows = new Map<string, OmnibusHistoryRow>()
    if (!ids.length) return rows
    const scopes = new Map<string, { tenantId: string; organizationId: string }>()
    for (const context of contexts) {
      scopes.set(configKey(context), { tenantId: context.tenantId, organizationId: context.organizationId })
    }
    for (const scope of scopes.values()) {
      const entries = await findWithDecryption(
        em,
        CatalogPriceHistoryEntry,
        { id: { $in: ids }, tenantId: scope.tenantId, organizationId: scope.organizationId },
        undefined,
        scope,
      )
      for (const entry of entries) rows.set(entry.id, toHistoryRow(entry))
    }
    return rows
  }
}

function configKey(context: Pick<OmnibusResolutionContext, 'tenantId' | 'organizationId'>): string {
  return `${context.tenantId}|${context.organizationId}`
}

function firstOfferCacheKey(lookup: PreparedLookup): string {
  return buildOmnibusCacheKey('first-offer', [
    lookup.context.tenantId,
    lookup.context.organizationId,
    lookup.offerId,
    lookup.presentedPriceKindId,
    lookup.context.currencyCode,
    lookup.channelId ?? 'none',
  ])
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}
