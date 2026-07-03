import { createHash } from 'node:crypto'
import { generateObject } from 'ai'
import type { AwilixContainer } from 'awilix'
import { createContainer } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import {
  AiModelFactoryError,
  createModelFactory,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { z } from 'zod'
import { resolveEntityFeatureAccess } from './widgetDataBatch'
import { buildKpiRequest, KPI_KEYS, type KpiKey, type KpiRangeInput } from './kpiRequests'
import type { AnalyticsRegistry } from '../services/analyticsRegistry'
import type { WidgetDataRequest, WidgetDataResponse } from '../services/widgetDataService'

const INSIGHTS_CACHE_TTL = 3_600_000
const DIGEST_TIMEOUT_MS = 15_000
const NUMERIC_TOLERANCE = 0.005
const INSIGHTS_DIGEST_SCHEMA = z.object({
  bullets: z.array(z.string()).max(5),
})

type DigestPayload = z.infer<typeof INSIGHTS_DIGEST_SCHEMA>
type AiModel = Parameters<typeof generateObject>[0]['model']

export type InsightMetric = {
  key: KpiKey
  label: string
  value: number
  previousValue: number | null
  deltaPct: number | null
}

export type InsightsResult = {
  metrics: InsightMetric[]
  digest: { bullets: string[]; generatedAt: string } | null
  aiAvailable: boolean
  cached: boolean
}

export type InsightsScope = {
  tenantId: string
  organizationIds?: string[]
  effectiveOrgScope?: string[] | 'all'
}

export type ComputeInsightsDeps = {
  widgetDataService: {
    fetchWidgetData(request: WidgetDataRequest): Promise<WidgetDataResponse>
  }
  analyticsRegistry: Pick<AnalyticsRegistry, 'getRequiredFeatures'>
  checkFeatures(features: string[]): Promise<boolean>
  cache?: CacheStrategy | null
  now?: () => Date
  createContainer?: typeof createContainer
  createModelFactory?: typeof createModelFactory
  generateObject?: typeof generateObject
  timeoutMs?: number
}

type CachedDigestState = {
  digest: InsightsResult['digest']
  aiAvailable: boolean
}

type CachedInsightsEntry = {
  metrics: InsightMetric[]
  digests: Record<string, CachedDigestState>
}

const METRIC_LABEL_KEYS: Record<KpiKey, string> = {
  revenue: 'dashboards.widgets.aiInsights.metrics.revenue',
  orders: 'dashboards.widgets.aiInsights.metrics.orders',
  aov: 'dashboards.widgets.aiInsights.metrics.aov',
  new_customers: 'dashboards.widgets.aiInsights.metrics.newCustomers',
}

const METRIC_PROMPT_LABELS: Record<KpiKey, string> = {
  revenue: 'Revenue',
  orders: 'Orders',
  aov: 'Average order value',
  new_customers: 'New customers',
}

export const INSIGHTS_DIGEST_SYSTEM_PROMPT =
  'You write concise dashboard insight bullets. The user-provided JSON is the only source of truth. Do not calculate or invent figures. Only mention numbers that appear in the JSON. Use plain language. Return JSON that matches the schema.'

function asAiModel(model: unknown): AiModel {
  return model as AiModel
}

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals
  return Math.round(value * multiplier) / multiplier
}

function normalizeMetricValue(value: number | null): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function calculateDeltaPct(value: number, previousValue: number | null, compare: KpiRangeInput['compare']): number | null {
  if (compare === 'none' || previousValue === null || previousValue === 0) return null
  return (value - previousValue) / Math.abs(previousValue)
}

function resolveEffectiveOrgScope(scope: InsightsScope): string[] | 'all' {
  const source = scope.effectiveOrgScope ?? scope.organizationIds
  if (source === 'all' || !Array.isArray(source) || source.length === 0) return 'all'
  return [...new Set(source)].sort((a, b) => a.localeCompare(b))
}

function buildInsightsCacheKey(scope: InsightsScope, range: KpiRangeInput): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify({
    tenantId: scope.tenantId,
    effectiveOrgScope: resolveEffectiveOrgScope(scope),
    from: range.from,
    to: range.to,
    compare: range.compare,
  }))
  return `dashboards:insights:${hash.digest('hex').slice(0, 24)}`
}

function getMetricSignature(metrics: InsightMetric[]): string {
  return metrics.map((metric) => metric.key).join('|') || 'none'
}

function sortMetrics(metrics: InsightMetric[]): InsightMetric[] {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]))
  return KPI_KEYS.flatMap((key) => {
    const metric = byKey.get(key)
    return metric ? [metric] : []
  })
}

function isInsightMetric(value: unknown): value is InsightMetric {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<InsightMetric>
  return (
    typeof candidate.key === 'string' &&
    (KPI_KEYS as readonly string[]).includes(candidate.key) &&
    typeof candidate.label === 'string' &&
    typeof candidate.value === 'number' &&
    (typeof candidate.previousValue === 'number' || candidate.previousValue === null) &&
    (typeof candidate.deltaPct === 'number' || candidate.deltaPct === null)
  )
}

function isCachedDigestState(value: unknown): value is CachedDigestState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CachedDigestState>
  const digest = candidate.digest
  const digestValid =
    digest === null ||
    (Boolean(digest) &&
      typeof digest === 'object' &&
      Array.isArray(digest.bullets) &&
      digest.bullets.every((bullet) => typeof bullet === 'string') &&
      typeof digest.generatedAt === 'string')
  return digestValid && typeof candidate.aiAvailable === 'boolean'
}

function isCachedInsightsEntry(value: unknown): value is CachedInsightsEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CachedInsightsEntry>
  if (!Array.isArray(candidate.metrics) || !candidate.metrics.every(isInsightMetric)) return false
  if (!candidate.digests || typeof candidate.digests !== 'object') return false
  return Object.values(candidate.digests).every(isCachedDigestState)
}

async function readCachedInsights(cache: CacheStrategy | null | undefined, cacheKey: string): Promise<CachedInsightsEntry | null> {
  if (!cache) return null
  try {
    const cached = await cache.get(cacheKey)
    return isCachedInsightsEntry(cached) ? cached : null
  } catch {
    return null
  }
}

async function writeCachedInsights(
  cache: CacheStrategy | null | undefined,
  cacheKey: string,
  scope: InsightsScope,
  entry: CachedInsightsEntry,
): Promise<void> {
  if (!cache) return
  try {
    await cache.set(cacheKey, entry, {
      ttl: INSIGHTS_CACHE_TTL,
      tags: [`dashboards:insights:${scope.tenantId}`],
    })
  } catch {
  }
}

function mergeMetrics(existing: InsightMetric[], next: InsightMetric[]): InsightMetric[] {
  const merged = new Map<KpiKey, InsightMetric>()
  for (const metric of existing) merged.set(metric.key, metric)
  for (const metric of next) merged.set(metric.key, metric)
  return sortMetrics([...merged.values()])
}

function selectMetricsForKeys(metrics: InsightMetric[], keys: readonly KpiKey[]): InsightMetric[] | null {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]))
  const selected: InsightMetric[] = []
  for (const key of keys) {
    const metric = byKey.get(key)
    if (!metric) return null
    selected.push(metric)
  }
  return selected
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function resolveDigestModel(deps: ComputeInsightsDeps): AiModel | null {
  try {
    const containerFactory = deps.createContainer ?? createContainer
    const factoryBuilder = deps.createModelFactory ?? createModelFactory
    const container = containerFactory()
    const factory = factoryBuilder(container as AwilixContainer)
    const resolution = factory.resolveModel({ moduleId: 'dashboards' })
    return asAiModel(resolution.model)
  } catch (err) {
    if (err instanceof AiModelFactoryError && err.code === 'no_provider_configured') return null
    return null
  }
}

function buildDigestPrompt(metrics: InsightMetric[], range: KpiRangeInput): string {
  const payload = {
    range: {
      from: range.from,
      to: range.to,
      compare: range.compare,
    },
    metrics: metrics.map((metric) => ({
      key: metric.key,
      label: METRIC_PROMPT_LABELS[metric.key],
      value: metric.value,
      previousValue: metric.previousValue,
      deltaPct: metric.deltaPct,
      deltaPctPercent: metric.deltaPct === null ? null : roundTo(metric.deltaPct * 100, 2),
    })),
  }
  return [
    `Metrics payload: ${JSON.stringify(payload)}`,
    'Write up to 5 bullets about what changed. Only reference the provided figures.',
    'The LLM must not compute totals, averages, percentages, or deltas. Use the provided value, previousValue, deltaPct, and deltaPctPercent fields exactly.',
    'Mention the comparison window in plain language when relevant.',
    'Use no markdown and no unexplained jargon.',
  ].join('\n')
}

async function generateDigest(
  deps: ComputeInsightsDeps,
  metrics: InsightMetric[],
  range: KpiRangeInput,
): Promise<CachedDigestState> {
  if (metrics.length === 0) return { digest: null, aiAvailable: false }

  const model = resolveDigestModel(deps)
  if (!model) return { digest: null, aiAvailable: false }

  try {
    const runGenerateObject = deps.generateObject ?? generateObject
    const result = await withTimeout(
      runGenerateObject({
        model,
        schema: INSIGHTS_DIGEST_SCHEMA,
        system: INSIGHTS_DIGEST_SYSTEM_PROMPT,
        prompt: buildDigestPrompt(metrics, range),
        temperature: 0,
      }),
      deps.timeoutMs ?? DIGEST_TIMEOUT_MS,
      `LLM insights digest timed out after ${deps.timeoutMs ?? DIGEST_TIMEOUT_MS}ms`,
    )
    const object = result.object as DigestPayload
    const bullets = validateDigestBullets(object.bullets, metrics, range)
    return {
      digest: bullets.length > 0
        ? { bullets, generatedAt: (deps.now?.() ?? new Date()).toISOString() }
        : null,
      aiAvailable: true,
    }
  } catch {
    return { digest: null, aiAvailable: false }
  }
}

async function buildAuthorizedMetrics(
  deps: ComputeInsightsDeps,
  range: KpiRangeInput,
): Promise<InsightMetric[]> {
  const requests = KPI_KEYS.map((key) => ({ key, request: buildKpiRequest(key, range) }))
  const access = await resolveEntityFeatureAccess(
    requests.map(({ request }) => request.entityType),
    (entityType) => deps.analyticsRegistry.getRequiredFeatures(entityType),
    deps.checkFeatures,
  )

  const authorized = requests.filter(({ request }) => access.get(request.entityType) !== false)
  const metrics = await Promise.all(
    authorized.map(async ({ key, request }): Promise<InsightMetric> => {
      const response = await deps.widgetDataService.fetchWidgetData(request)
      const value = normalizeMetricValue(response.value)
      const previousValue = range.compare === 'none'
        ? null
        : (Number.isFinite(response.comparison?.value) ? Number(response.comparison?.value) : null)
      return {
        key,
        label: METRIC_LABEL_KEYS[key],
        value,
        previousValue,
        deltaPct: calculateDeltaPct(value, previousValue, range.compare),
      }
    }),
  )

  return sortMetrics(metrics)
}

export async function computeInsights(
  deps: ComputeInsightsDeps,
  scope: InsightsScope,
  range: KpiRangeInput,
): Promise<InsightsResult> {
  const requests = KPI_KEYS.map((key) => ({ key, request: buildKpiRequest(key, range) }))
  const access = await resolveEntityFeatureAccess(
    requests.map(({ request }) => request.entityType),
    (entityType) => deps.analyticsRegistry.getRequiredFeatures(entityType),
    deps.checkFeatures,
  )
  const authorizedKeys = requests
    .filter(({ request }) => access.get(request.entityType) !== false)
    .map(({ key }) => key)

  const cacheKey = buildInsightsCacheKey(scope, range)
  const cachedEntry = await readCachedInsights(deps.cache, cacheKey)
  const cachedMetrics = cachedEntry ? selectMetricsForKeys(cachedEntry.metrics, authorizedKeys) : null

  if (cachedEntry && cachedMetrics) {
    const signature = getMetricSignature(cachedMetrics)
    const cachedDigest = cachedEntry.digests[signature]
    if (cachedDigest) {
      return {
        metrics: cachedMetrics,
        digest: cachedDigest.digest,
        aiAvailable: cachedDigest.aiAvailable,
        cached: true,
      }
    }

    const digestState = await generateDigest(deps, cachedMetrics, range)
    await writeCachedInsights(deps.cache, cacheKey, scope, {
      metrics: cachedEntry.metrics,
      digests: { ...cachedEntry.digests, [signature]: digestState },
    })
    return {
      metrics: cachedMetrics,
      digest: digestState.digest,
      aiAvailable: digestState.aiAvailable,
      cached: true,
    }
  }

  const freshMetrics = await buildAuthorizedMetrics(deps, range)
  const signature = getMetricSignature(freshMetrics)
  const digestState = await generateDigest(deps, freshMetrics, range)
  await writeCachedInsights(deps.cache, cacheKey, scope, {
    metrics: mergeMetrics(cachedEntry?.metrics ?? [], freshMetrics),
    digests: { ...(cachedEntry?.digests ?? {}), [signature]: digestState },
  })

  return {
    metrics: freshMetrics,
    digest: digestState.digest,
    aiAvailable: digestState.aiAvailable,
    cached: false,
  }
}

function addAllowedNumber(target: Set<number>, value: number): void {
  if (!Number.isFinite(value)) return
  for (const base of [value, Math.abs(value)]) {
    for (const decimals of [0, 1, 2]) {
      target.add(roundTo(base, decimals))
    }
    target.add(base)
    if (Math.abs(base) >= 1_000) {
      for (const scale of [1_000, 1_000_000]) {
        if (Math.abs(base) < scale) continue
        for (const decimals of [0, 1, 2]) {
          target.add(roundTo(base / scale, decimals) * scale)
        }
      }
    }
  }
}

function buildAllowedNumberSet(metrics: InsightMetric[], range?: { from: string; to: string }): Set<number> {
  const allowed = new Set<number>()
  for (const metric of metrics) {
    addAllowedNumber(allowed, metric.value)
    if (metric.previousValue !== null) addAllowedNumber(allowed, metric.previousValue)
    if (metric.deltaPct !== null) addAllowedNumber(allowed, metric.deltaPct)
  }
  if (range) {
    // The prompt asks the model to mention the comparison window in plain language
    // ("last 7 days", "June 2026") — whitelist range-derived numbers so those bullets
    // survive validation.
    for (const endpoint of [range.from, range.to]) {
      const [year, month, day] = endpoint.split('-').map((part) => Number(part))
      addAllowedNumber(allowed, year)
      addAllowedNumber(allowed, month)
      addAllowedNumber(allowed, day)
    }
    const fromMs = Date.parse(`${range.from}T00:00:00Z`)
    const toMs = Date.parse(`${range.to}T00:00:00Z`)
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs) {
      const daysInclusive = Math.round((toMs - fromMs) / 86_400_000) + 1
      addAllowedNumber(allowed, daysInclusive)
    }
  }
  return allowed
}

const NUMERIC_TOKEN_PATTERN =
  /[+\-−]?\s*(?:[$€£¥]\s*)?(?:\d{1,3}(?:[.,\s\u00a0]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s*[kKmM%])?/g

function normalizeSeparatedNumber(value: string): number | null {
  let raw = value.replace(/[\s\u00a0]/g, '')
  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastDot > lastComma) {
      raw = raw.replace(/,/g, '')
    } else {
      raw = raw.replace(/\./g, '').replace(',', '.')
    }
  } else if (lastComma >= 0) {
    const parts = raw.split(',')
    const fractional = parts[parts.length - 1] ?? ''
    if (parts.length > 2 || fractional.length === 3) {
      raw = raw.replace(/,/g, '')
    } else {
      raw = raw.replace(',', '.')
    }
  } else if (lastDot >= 0) {
    const parts = raw.split('.')
    const fractional = parts[parts.length - 1] ?? ''
    if (parts.length > 2 || fractional.length === 3) {
      raw = raw.replace(/\./g, '')
    }
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNumericToken(token: string): number[] {
  let raw = token
    .trim()
    .replace(/[−]/g, '-')
    .replace(/[$€£¥]/g, '')
    .replace(/\s+/g, '')

  const suffixMatch = raw.match(/([kKmM%])$/)
  const suffix = suffixMatch?.[1] ?? null
  if (suffix) raw = raw.slice(0, -1)

  const parsed = normalizeSeparatedNumber(raw)
  if (parsed === null) return []

  let value = parsed
  if (suffix === 'k' || suffix === 'K') value *= 1_000
  if (suffix === 'm' || suffix === 'M') value *= 1_000_000
  if (suffix === '%') return [value, value / 100]
  return [value]
}

function matchesAllowedNumber(candidates: number[], allowed: Set<number>): boolean {
  for (const candidate of candidates) {
    for (const allowedValue of allowed) {
      const tolerance = Math.max(Math.abs(allowedValue) * NUMERIC_TOLERANCE, 0.000001)
      if (Math.abs(candidate - allowedValue) <= tolerance) return true
    }
  }
  return false
}

export function validateDigestBullets(bullets: string[], metrics: InsightMetric[], range?: { from: string; to: string }): string[] {
  const allowed = buildAllowedNumberSet(metrics, range)
  return bullets.filter((bullet) => {
    const tokens = bullet.match(NUMERIC_TOKEN_PATTERN) ?? []
    if (tokens.length === 0) return true
    return tokens.every((token) => {
      const candidates = parseNumericToken(token)
      return candidates.length > 0 && matchesAllowedNumber(candidates, allowed)
    })
  })
}
