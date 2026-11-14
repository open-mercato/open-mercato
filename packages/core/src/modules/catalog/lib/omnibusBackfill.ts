import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CatalogPriceHistoryEntry, CatalogProductPrice } from '../data/entities'
import { omnibusBackfillOptionsSchema, type OmnibusBackfillOptionsInput } from '../data/validators'
import {
  isCompletePriceHistoryInput,
  isOmnibusTrackedPrice,
  priceHistoryInputFromRecord,
  recordPriceHistoryEntries,
} from './omnibus'
import { invalidateOmnibusTenantCache } from './omnibusCache'
import { listInScopeOmnibusChannels } from './omnibusConfig'
import {
  OMNIBUS_CONFIG_MODULE_ID,
  OMNIBUS_CONFIG_NAME,
  omnibusConfigSchema,
  type OmnibusConfig,
} from './omnibusTypes'

const DAY_MS = 24 * 60 * 60 * 1000

export const OMNIBUS_UNSCOPED_COVERAGE_KEY = ''

export type OmnibusBackfillDeps = {
  em: EntityManager
  moduleConfigService: ModuleConfigService
  cache?: CacheStrategy | null
  now?: Date
}

export type OmnibusBackfillTarget = {
  coverageKey: string
  channelId: string | null
  lookbackDays: number
}

export type OmnibusBackfillTargetResult = OmnibusBackfillTarget & {
  recordedAt: string
  scanned: number
  alreadyCovered: number
  missing: number
  created: number
  skippedIncomplete: number
  skippedUntracked: number
}

export type OmnibusBackfillResult = {
  dryRun: boolean
  tenantId: string
  organizationId: string | null
  targets: OmnibusBackfillTargetResult[]
  coverageRecorded: string[]
}

async function readOmnibusConfig(service: ModuleConfigService, tenantId: string): Promise<OmnibusConfig | null> {
  const raw = await service.getValue<unknown>(OMNIBUS_CONFIG_MODULE_ID, OMNIBUS_CONFIG_NAME, { scope: { tenantId } })
  if (raw === null || raw === undefined) return null
  const parsed = omnibusConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('[internal] Stored catalog omnibus config is invalid; fix it before running the backfill')
  }
  return parsed.data
}

export function resolveOmnibusBackfillTargets(
  config: OmnibusConfig,
  options: { channelId?: string | null; unscoped?: boolean },
): OmnibusBackfillTarget[] {
  if (options.channelId) {
    const lookbackDays = config.channels[options.channelId]?.lookbackDays ?? config.lookbackDays
    return [{ coverageKey: options.channelId, channelId: options.channelId, lookbackDays }]
  }
  const channelTargets = listInScopeOmnibusChannels(config).map((channelId) => ({
    coverageKey: channelId,
    channelId,
    lookbackDays: config.channels[channelId]?.lookbackDays ?? config.lookbackDays,
  }))
  const unscopedLookbackDays = Math.max(config.lookbackDays, ...channelTargets.map((target) => target.lookbackDays))
  const unscopedTarget: OmnibusBackfillTarget = {
    coverageKey: OMNIBUS_UNSCOPED_COVERAGE_KEY,
    channelId: null,
    lookbackDays: unscopedLookbackDays,
  }
  if (options.unscoped) return [unscopedTarget]
  return [...channelTargets, unscopedTarget]
}

async function backfillTarget(
  deps: OmnibusBackfillDeps,
  scope: { tenantId: string; organizationId: string | null },
  target: OmnibusBackfillTarget,
  options: { batchSize: number; dryRun: boolean; now: Date },
): Promise<OmnibusBackfillTargetResult> {
  const windowStart = new Date(options.now.getTime() - target.lookbackDays * DAY_MS)
  const recordedAt = new Date(windowStart.getTime() - 1)
  const result: OmnibusBackfillTargetResult = {
    ...target,
    recordedAt: recordedAt.toISOString(),
    scanned: 0,
    alreadyCovered: 0,
    missing: 0,
    created: 0,
    skippedIncomplete: 0,
    skippedUntracked: 0,
  }
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const orgFilter = scope.organizationId ? { organizationId: scope.organizationId } : {}
  let cursor: string | null = null
  for (;;) {
    const batchEm = deps.em.fork()
    const prices: CatalogProductPrice[] = await findWithDecryption<CatalogProductPrice>(
      batchEm,
      CatalogProductPrice,
      {
        tenantId: scope.tenantId,
        ...orgFilter,
        channelId: target.channelId,
        ...(cursor ? { id: { $gt: cursor } } : {}),
      },
      { populate: ['priceKind', 'variant', 'offer'], orderBy: { id: 'asc' }, limit: options.batchSize },
      decryptionScope,
    )
    if (!prices.length) break
    cursor = prices[prices.length - 1].id
    result.scanned += prices.length
    const existing = await findWithDecryption<CatalogPriceHistoryEntry>(
      batchEm,
      CatalogPriceHistoryEntry,
      { tenantId: scope.tenantId, ...orgFilter, priceId: { $in: prices.map((price) => price.id) } },
      { fields: ['id', 'priceId'] },
      decryptionScope,
    )
    const covered = new Set(existing.map((entry) => entry.priceId))
    const uncovered = prices.filter((price) => !covered.has(price.id))
    result.alreadyCovered += prices.length - uncovered.length
    const inputs = uncovered.map(priceHistoryInputFromRecord)
    const tracked = inputs.filter(isOmnibusTrackedPrice)
    result.skippedUntracked += inputs.length - tracked.length
    const complete = tracked.filter(isCompletePriceHistoryInput)
    result.skippedIncomplete += tracked.length - complete.length
    result.missing += complete.length
    if (!options.dryRun && complete.length) {
      const written = await recordPriceHistoryEntries(batchEm, complete, 'create', { recordedAt, source: 'system' })
      result.created += written.recorded
    }
    if (prices.length < options.batchSize) break
  }
  return result
}

async function recordBackfillCoverage(
  service: ModuleConfigService,
  tenantId: string,
  targets: OmnibusBackfillTargetResult[],
  completedAt: Date,
): Promise<void> {
  const latest = await readOmnibusConfig(service, tenantId)
  const coverage = { ...(latest?.backfillCoverage ?? {}) }
  for (const target of targets) {
    coverage[target.coverageKey] = { completedAt: completedAt.toISOString(), lookbackDays: target.lookbackDays }
  }
  const next = omnibusConfigSchema.parse({ ...(latest ?? {}), backfillCoverage: coverage })
  await service.setValue(OMNIBUS_CONFIG_MODULE_ID, OMNIBUS_CONFIG_NAME, next, { tenantId })
}

export async function runOmnibusBackfill(
  deps: OmnibusBackfillDeps,
  input: OmnibusBackfillOptionsInput,
): Promise<OmnibusBackfillResult> {
  const options = omnibusBackfillOptionsSchema.parse(input)
  const now = deps.now ?? new Date()
  const scope = { tenantId: options.tenantId, organizationId: options.organizationId ?? null }
  const config = (await readOmnibusConfig(deps.moduleConfigService, options.tenantId)) ?? omnibusConfigSchema.parse({})
  const targets = resolveOmnibusBackfillTargets(config, { channelId: options.channelId, unscoped: options.unscoped })
  const results: OmnibusBackfillTargetResult[] = []
  for (const target of targets) {
    results.push(
      await backfillTarget(deps, scope, target, { batchSize: options.batchSize, dryRun: options.dryRun, now }),
    )
  }
  if (options.dryRun) {
    return { dryRun: true, tenantId: scope.tenantId, organizationId: scope.organizationId, targets: results, coverageRecorded: [] }
  }
  const recordsCoverage = scope.organizationId === null
  if (recordsCoverage) {
    await recordBackfillCoverage(deps.moduleConfigService, options.tenantId, results, deps.now ?? new Date())
  }
  await invalidateOmnibusTenantCache(deps.cache ?? null, options.tenantId)
  return {
    dryRun: false,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    targets: results,
    coverageRecorded: recordsCoverage ? results.map((target) => target.coverageKey) : [],
  }
}
