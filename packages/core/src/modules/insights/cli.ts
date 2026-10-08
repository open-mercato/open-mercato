import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { ActionLogCauseCoverageRow } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { listExplainResources, type RegisteredExplainResource } from './lib/explain-registry'

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

const insightsCliCommands: ModuleCli[] = [explainCoverage]

export default insightsCliCommands
