import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { ActionLogCauseCoverageRow } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { listExplainResources, type RegisteredExplainResource } from './lib/explain-registry'
import {
  pruneXrayProjection,
  readXrayStatus,
  rebuildXrayProjection,
  runXrayBackfillJob,
  startXrayBackfill,
  type XrayBackfillStart,
  type XrayStatus,
} from './lib/projection/jobs'
import type { XrayContainer } from './lib/projection/runtime'
import type { ProjectionScope } from './lib/projection/types'

export const COVERAGE_DEFAULT_LIMIT = 100
export const COVERAGE_MAX_LIMIT = 1000
export const LEGACY_CAUSE_BUCKET = 'legacy'

export type CoverageArgs = {
  tenantId: string | null
  organizationId: string | null
  since: Date | null
  limit: number
}

export type CoverageArgsResult = { ok: true; args: CoverageArgs } | { ok: false; error: string }

function readOption(rest: string[], names: string[]): string | null {
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg?.startsWith('--')) continue
    const [rawName, inlineValue] = arg.slice(2).split('=')
    if (!names.includes(rawName)) continue
    if (inlineValue !== undefined) return inlineValue
    const next = rest[index + 1]
    return next && !next.startsWith('--') ? next : null
  }
  return null
}

export function parseCoverageArgs(rest: string[]): CoverageArgsResult {
  const tenantId = readOption(rest, ['tenant', 'tenantId'])
  const organizationId = readOption(rest, ['org', 'orgId', 'organizationId'])
  const sinceRaw = readOption(rest, ['since'])
  const limitRaw = readOption(rest, ['limit'])
  if (tenantId !== null && !isUuid(tenantId)) return { ok: false, error: '--tenant must be a UUID' }
  if (organizationId !== null && !isUuid(organizationId)) return { ok: false, error: '--org must be a UUID' }
  if (organizationId !== null && tenantId === null) return { ok: false, error: '--org requires --tenant' }
  let since: Date | null = null
  if (sinceRaw !== null) {
    const parsed = Date.parse(sinceRaw)
    if (Number.isNaN(parsed)) return { ok: false, error: '--since must be an ISO-8601 date' }
    since = new Date(parsed)
  }
  let limit = COVERAGE_DEFAULT_LIMIT
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, error: '--limit must be a positive integer' }
    limit = Math.min(parsed, COVERAGE_MAX_LIMIT)
  }
  return { ok: true, args: { tenantId, organizationId, since, limit } }
}

export type ResourceCoverage = {
  resourceKind: string
  moduleId: string
  total: number
  byCause: Record<string, number>
  unknownShare: number
  legacyShare: number
  noHistoryReasonKey: string | null
  sampledRecords: number | null
  recordsWithoutHistory: number | null
}

function resolveLogKinds(registered: RegisteredExplainResource): string[] {
  const declared = (registered.descriptor.logResourceKinds ?? []).filter((kind) => kind.length > 0)
  return declared.length > 0 ? Array.from(new Set(declared)) : [registered.descriptor.resourceKind]
}

function share(part: number, total: number): number {
  return total > 0 ? part / total : 0
}

export async function collectExplainCoverage(params: {
  resources: RegisteredExplainResource[]
  actionLogService: Pick<ActionLogService, 'countHistoryByCause' | 'findResourceIdsWithHistory'>
  em: EntityManager
  args: CoverageArgs
}): Promise<ResourceCoverage[]> {
  const { args } = params
  const rows: ActionLogCauseCoverageRow[] = await params.actionLogService.countHistoryByCause({
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    resourceKinds: params.resources.flatMap(resolveLogKinds),
    since: args.since,
  })
  const coverage: ResourceCoverage[] = []
  for (const registered of params.resources) {
    const logKinds = new Set(resolveLogKinds(registered))
    const byCause: Record<string, number> = {}
    let total = 0
    for (const row of rows) {
      if (!row.resourceKind || !logKinds.has(row.resourceKind)) continue
      const bucket = row.causeKind ?? LEGACY_CAUSE_BUCKET
      byCause[bucket] = (byCause[bucket] ?? 0) + row.count
      total += row.count
    }
    let sampledRecords: number | null = null
    let recordsWithoutHistory: number | null = null
    const listRecordIds = registered.descriptor.listRecordIds
    if (args.tenantId && typeof listRecordIds === 'function') {
      const recordIds = await listRecordIds({
        em: params.em,
        resolve: () => undefined,
        scope: { tenantId: args.tenantId, organizationIds: args.organizationId ? [args.organizationId] : null },
        userId: null,
        locale: null,
      }, { limit: args.limit, afterId: null })
      const sampled = Array.from(new Set(recordIds)).slice(0, args.limit)
      const withHistory = new Set(await params.actionLogService.findResourceIdsWithHistory({
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        resourceKinds: Array.from(logKinds),
        resourceIds: sampled,
      }))
      sampledRecords = sampled.length
      recordsWithoutHistory = sampled.filter((id) => !withHistory.has(id)).length
    }
    coverage.push({
      resourceKind: registered.descriptor.resourceKind,
      moduleId: registered.moduleId,
      total,
      byCause,
      unknownShare: share(byCause.unknown ?? 0, total),
      legacyShare: share(byCause[LEGACY_CAUSE_BUCKET] ?? 0, total),
      noHistoryReasonKey: registered.descriptor.noHistory?.reasonKey ?? null,
      sampledRecords,
      recordsWithoutHistory,
    })
  }
  return coverage.sort((left, right) => left.resourceKind.localeCompare(right.resourceKind))
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatExplainCoverage(coverage: ResourceCoverage[], args: CoverageArgs): string[] {
  const lines = [
    `[insights] Explain coverage (tenant=${args.tenantId ?? 'all'}, org=${args.organizationId ?? 'all'}, since=${args.since ? args.since.toISOString() : 'beginning'})`,
  ]
  if (coverage.length === 0) {
    lines.push('  No explain resources are registered. Enable modules that ship insights.explain.ts and run `yarn generate`.')
    return lines
  }
  for (const item of coverage) {
    lines.push(`- ${item.resourceKind} (${item.moduleId})`)
    if (item.noHistoryReasonKey) lines.push(`    declared without history: ${item.noHistoryReasonKey}`)
    lines.push(`    history rows: ${item.total}`)
    const buckets = Object.entries(item.byCause).sort(([left], [right]) => left.localeCompare(right))
    for (const [bucket, count] of buckets) lines.push(`      ${bucket}: ${count} (${formatPercent(share(count, item.total))})`)
    lines.push(`    unknown cause share: ${formatPercent(item.unknownShare)}`)
    lines.push(`    legacy (recorded before causation) share: ${formatPercent(item.legacyShare)}`)
    if (item.sampledRecords === null) {
      lines.push('    records without history: n/a (requires --tenant and a resource that lists its records)')
    } else {
      lines.push(`    records without history: ${item.recordsWithoutHistory} of ${item.sampledRecords} sampled`)
    }
  }
  return lines
}

const explainCoverage: ModuleCli = {
  command: 'explain:coverage',
  async run(rest) {
    const parsed = parseCoverageArgs(rest)
    if (!parsed.ok) {
      console.error(`[insights] ${parsed.error}`)
      console.error('Usage: mercato insights explain:coverage [--tenant <id>] [--org <id>] [--since <iso>] [--limit N]')
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    const actionLogService = container.resolve('actionLogService') as ActionLogService
    const em = container.resolve('em') as EntityManager
    const coverage = await collectExplainCoverage({
      resources: listExplainResources(),
      actionLogService,
      em,
      args: parsed.args,
    })
    for (const line of formatExplainCoverage(coverage, parsed.args)) console.log(line)
  },
}

export type XrayCliArgs = {
  tenantId: string | null
  organizationId: string | null
  inline: boolean
}

export type XrayCliArgsResult = { ok: true; args: XrayCliArgs } | { ok: false; error: string }

const XRAY_USAGE = '[--tenant <id>] [--org <id>]'
const XRAY_INLINE_RETRY_MS = 1000
const XRAY_INLINE_MAX_SLICES = 100000

export function parseXrayArgs(rest: string[]): XrayCliArgsResult {
  const tenantId = readOption(rest, ['tenant', 'tenantId'])
  const organizationId = readOption(rest, ['org', 'orgId', 'organizationId'])
  if (tenantId !== null && !isUuid(tenantId)) return { ok: false, error: '--tenant must be a UUID' }
  if (organizationId !== null && !isUuid(organizationId)) return { ok: false, error: '--org must be a UUID' }
  if (organizationId !== null && tenantId === null) return { ok: false, error: '--org requires --tenant' }
  return {
    ok: true,
    args: {
      tenantId: tenantId ? tenantId.toLowerCase() : null,
      organizationId: organizationId ? organizationId.toLowerCase() : null,
      inline: rest.includes('--inline'),
    },
  }
}

export async function resolveXrayTargets(em: EntityManager, args: XrayCliArgs): Promise<ProjectionScope[]> {
  if (args.tenantId && args.organizationId) return [{ tenantId: args.tenantId, organizationId: args.organizationId }]
  const organizations = await findWithDecryption(
    em,
    Organization,
    { deletedAt: null, ...(args.tenantId ? { tenant: args.tenantId } : {}) },
    { orderBy: { id: 'asc' } },
    { tenantId: args.tenantId, organizationId: null },
  )
  return organizations
    .map((organization) => {
      const tenantId = typeof organization.tenant === 'string' ? organization.tenant : organization.tenant?.id
      return tenantId ? { tenantId: String(tenantId), organizationId: String(organization.id) } : null
    })
    .filter((scope): scope is ProjectionScope => scope !== null)
}

export function formatXrayStatus(status: XrayStatus): string[] {
  const cursor = status.cursor
  const lines = [
    `- tenant=${status.scope.tenantId} org=${status.scope.organizationId}`,
    `    settings: enabled=${status.settings.enabled} retentionDays=${status.settings.retentionDays} ingestToggle=${status.ingestEnabled ? 'on' : 'off'}`,
  ]
  if (!cursor) {
    lines.push('    cursor: none (not ingested yet)')
  } else {
    lines.push(`    cursor: status=${cursor.status} computedThrough=${cursor.lastCreatedAt ?? 'n/a'} contract=${cursor.contractHash === status.registry.contractHash ? 'current' : 'outdated'}`)
    if (cursor.scanId) {
      lines.push(`    scan: ${cursor.scanKind} ${cursor.scanId} position=${cursor.scanAfterCreatedAt ?? 'start'} until=${cursor.scanUntil ?? 'n/a'} processed=${cursor.scanProcessedCount}`)
    }
    if (cursor.lastError) lines.push(`    last error: ${cursor.lastError}`)
  }
  for (const count of status.counts) {
    lines.push(`    ${count.processKey}: events=${count.events} voided=${count.voidedEvents} cases=${count.cases} open=${count.openCases}`)
  }
  return lines
}

function describeStart(scope: ProjectionScope, started: XrayBackfillStart): string {
  if (!started.ok) return `[insights] org ${scope.organizationId}: skipped (${started.reason})`
  return `[insights] org ${scope.organizationId}: scan ${started.scanId} started${started.progressJobId ? ` (progress job ${started.progressJobId})` : ''}`
}

async function drainScanInline(container: XrayContainer, scope: ProjectionScope, started: XrayBackfillStart): Promise<string> {
  if (!started.ok) return started.reason
  const payload = { scope: { ...scope, userId: null }, scanId: started.scanId, chainId: started.chainId, progressJobId: started.progressJobId }
  for (let slice = 0; slice < XRAY_INLINE_MAX_SLICES; slice += 1) {
    const status = await runXrayBackfillJob(container, payload, { enqueueContinuation: false })
    if (status === 'lease_busy' || status === 'lease_lost') {
      await new Promise((resolve) => setTimeout(resolve, XRAY_INLINE_RETRY_MS))
      continue
    }
    if (status !== 'budget_exhausted') return status
  }
  return 'budget_exhausted'
}

async function runXrayCommand(
  rest: string[],
  command: string,
  run: (container: XrayContainer, scope: ProjectionScope, args: XrayCliArgs) => Promise<void>,
): Promise<void> {
  const parsed = parseXrayArgs(rest)
  if (!parsed.ok) {
    console.error(`[insights] ${parsed.error}`)
    console.error(`Usage: mercato insights ${command} ${XRAY_USAGE}`)
    process.exitCode = 1
    return
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const targets = await resolveXrayTargets(em, parsed.args)
  if (targets.length === 0) {
    console.log('[insights] No organization matches the given scope.')
    return
  }
  for (const scope of targets) await run(container, scope, parsed.args)
}

async function backfillLabels(): Promise<{ name: string; description: string }> {
  const { translate } = await resolveTranslations()
  return {
    name: translate('insights.xray.backfill.jobName', 'Process X-Ray backfill'),
    description: translate('insights.xray.backfill.jobDescription', 'Projects the audit history of this organization into Process X-Ray.'),
  }
}

const xrayStatus: ModuleCli = {
  command: 'xray:status',
  async run(rest) {
    await runXrayCommand(rest, 'xray:status', async (container, scope) => {
      for (const line of formatXrayStatus(await readXrayStatus(container, scope))) console.log(line)
    })
  },
}

const xrayBackfill: ModuleCli = {
  command: 'xray:backfill',
  async run(rest) {
    const labels = await backfillLabels()
    await runXrayCommand(rest, 'xray:backfill [--inline]', async (container, scope, args) => {
      const started = await startXrayBackfill(container, scope, { userId: null, ...labels, enqueue: !args.inline })
      console.log(describeStart(scope, started))
      if (args.inline && started.ok) console.log(`[insights] org ${scope.organizationId}: ${await drainScanInline(container, scope, started)}`)
    })
  },
}

const xrayRebuild: ModuleCli = {
  command: 'xray:rebuild',
  async run(rest) {
    const labels = await backfillLabels()
    await runXrayCommand(rest, 'xray:rebuild [--inline]', async (container, scope, args) => {
      const started = await rebuildXrayProjection(container, scope, { userId: null, ...labels, enqueue: !args.inline })
      console.log(describeStart(scope, started))
      if (args.inline && started.ok) console.log(`[insights] org ${scope.organizationId}: ${await drainScanInline(container, scope, started)}`)
    })
  },
}

const xrayPrune: ModuleCli = {
  command: 'xray:prune',
  async run(rest) {
    await runXrayCommand(rest, 'xray:prune', async (container, scope) => {
      const outcome = await pruneXrayProjection(container, scope)
      console.log(outcome.ok
        ? `[insights] org ${scope.organizationId}: pruned ${outcome.removed} rows (cutoff ${outcome.cutoff ?? 'n/a'})`
        : `[insights] org ${scope.organizationId}: skipped (${outcome.reason})`)
    })
  },
}

const insightsCliCommands: ModuleCli[] = [explainCoverage, xrayStatus, xrayBackfill, xrayRebuild, xrayPrune]

export default insightsCliCommands
