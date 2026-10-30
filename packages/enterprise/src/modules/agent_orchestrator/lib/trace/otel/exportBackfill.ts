import { z } from 'zod'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import type { EnqueueOptions } from '@open-mercato/queue'
import type { OtelExportJobPayload } from '../../queue'
import type { OtelExportSettings } from '../../../data/validators'
import {
  OTEL_EXPORT_DEFAULT_SERVICE_NAME,
  isExportEnabledFor,
  readOtelExportSettings,
  resolveOtelExportDeployment,
  type OtelExportContainer,
} from './exportSettings'
import { readDeploymentEnvironment } from './exportJob'
import type { RunExportBundle } from './loadRunExportBundle'
import { mapAgentRunToOtlp } from './mapAgentRunToOtlp'
import { encodeOtlpTraceRequest } from './otlpJson'

export const OTEL_EXPORT_BACKFILL_DEFAULT_LIMIT = 100
export const OTEL_EXPORT_BACKFILL_MAX_LIMIT = 1000

export const OTEL_EXPORT_BACKFILL_USAGE =
  'Usage: mercato agent_orchestrator otel:export (--run <runId> | --since <iso> [--until <iso>]) [--tenant <tenantId>] [--limit <1-1000>] [--dry-run]'

type EnvLike = Record<string, string | undefined>

const VALUE_OPTIONS = ['run', 'since', 'until', 'tenant', 'limit'] as const
type ValueOption = (typeof VALUE_OPTIONS)[number]

const isoDateTime = z.string().datetime({ offset: true })

const backfillArgsSchema = z
  .object({
    run: z.string().uuid().optional(),
    since: isoDateTime.optional(),
    until: isoDateTime.optional(),
    tenant: z.string().uuid().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(OTEL_EXPORT_BACKFILL_MAX_LIMIT)
      .default(OTEL_EXPORT_BACKFILL_DEFAULT_LIMIT),
    dryRun: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.run) === Boolean(value.since)) {
      ctx.addIssue({ code: 'custom', message: 'pass exactly one of --run or --since' })
    }
    if (value.until && !value.since) {
      ctx.addIssue({ code: 'custom', message: '--until requires --since' })
    }
    if (value.since && value.until && Date.parse(value.until) <= Date.parse(value.since)) {
      ctx.addIssue({ code: 'custom', message: '--until must be later than --since' })
    }
  })

export type OtelExportBackfillArgs = z.infer<typeof backfillArgsSchema>

export type ParseOtelExportBackfillArgsResult =
  | { ok: true; args: OtelExportBackfillArgs }
  | { ok: false; error: string }

function isValueOption(name: string): name is ValueOption {
  return (VALUE_OPTIONS as readonly string[]).includes(name)
}

export function parseOtelExportBackfillArgs(rest: readonly string[]): ParseOtelExportBackfillArgsResult {
  const raw: Partial<Record<ValueOption, string>> & { dryRun?: boolean } = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token === '--dry-run') {
      raw.dryRun = true
      continue
    }
    const name = token.startsWith('--') ? token.slice(2) : ''
    if (!isValueOption(name)) return { ok: false, error: `unknown argument "${token}"` }
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) return { ok: false, error: `--${name} requires a value` }
    if (raw[name] !== undefined) return { ok: false, error: `--${name} may be passed only once` }
    raw[name] = value
    index += 1
  }
  const parsed = backfillArgsSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? `--${String(issue.path[0])}: ` : ''
    return { ok: false, error: `${path}${issue?.message ?? 'invalid arguments'}` }
  }
  return { ok: true, args: parsed.data }
}

export type OtelExportBackfillFilter = {
  deletedAt: null
  status: { $ne: 'running' }
  id?: string
  tenantId?: string
  createdAt?: { $gte: Date; $lt?: Date }
}

/** Terminal, non-deleted runs: one run by id, or a `[since, until)` createdAt window; optionally one tenant. */
export function buildOtelExportBackfillFilter(args: OtelExportBackfillArgs): OtelExportBackfillFilter {
  const filter: OtelExportBackfillFilter = { deletedAt: null, status: { $ne: 'running' } }
  if (args.run) filter.id = args.run
  if (args.tenant) filter.tenantId = args.tenant
  if (args.since) {
    filter.createdAt = { $gte: new Date(args.since) }
    if (args.until) filter.createdAt.$lt = new Date(args.until)
  }
  return filter
}

/**
 * One OTLP/JSON export request per line (NDJSON), built exactly like the
 * exporter builds them. User ids are never included; service name/version fall
 * back to the deployment-independent defaults when the deployment is off.
 */
export function buildOtelExportDryRunLines(bundle: RunExportBundle, env: EnvLike = process.env): string[] {
  const deployment = resolveOtelExportDeployment(env)
  const chunks = mapAgentRunToOtlp(bundle, {
    exportUserIds: false,
    serviceName: deployment.enabled ? deployment.serviceName : OTEL_EXPORT_DEFAULT_SERVICE_NAME,
    serviceVersion: APP_VERSION,
    environment: readDeploymentEnvironment(env),
    scopeVersion: APP_VERSION,
  })
  return chunks.map((chunk) => JSON.stringify(encodeOtlpTraceRequest(chunk)))
}

export type OtelExportBackfillRunRow = {
  id: string
  tenantId: string
  organizationId: string
  agentId: string
  source: string | null
}

export type OtelExportBackfillSkipReason =
  | 'tenant_disabled'
  | 'agent_not_allowed'
  | 'source_not_exported'
  | 'not_found'

export type OtelExportBackfillSummary =
  | { mode: 'deployment_disabled'; selected: number }
  | { mode: 'dry_run'; selected: number; printed: number; skipped: Partial<Record<OtelExportBackfillSkipReason, number>> }
  | { mode: 'enqueue'; selected: number; enqueued: number; skipped: Partial<Record<OtelExportBackfillSkipReason, number>> }

export type OtelExportBackfillDeps = {
  container: OtelExportContainer
  selectRuns: (filter: OtelExportBackfillFilter, limit: number) => Promise<OtelExportBackfillRunRow[]>
  loadBundle: (runId: string) => Promise<RunExportBundle | null>
  enqueue: (payload: OtelExportJobPayload, options?: EnqueueOptions) => Promise<unknown>
  writeLine: (line: string) => void
  env?: EnvLike
}

function skipReasonFor(settings: OtelExportSettings, run: OtelExportBackfillRunRow): OtelExportBackfillSkipReason {
  if (!settings.enabled) return 'tenant_disabled'
  if (settings.agentAllowlist && !settings.agentAllowlist.includes(run.agentId)) return 'agent_not_allowed'
  return 'source_not_exported'
}

function countSkip(
  skipped: Partial<Record<OtelExportBackfillSkipReason, number>>,
  reason: OtelExportBackfillSkipReason,
): void {
  skipped[reason] = (skipped[reason] ?? 0) + 1
}

/**
 * Backfill for terminal runs. `dryRun` prints the encoded requests and never
 * touches the network or the queue; otherwise the deployment switch must be on
 * and each run passes the same tenant gate as the live exporter before a
 * `{ runId, attempt: 0 }` job is enqueued without delay (the worker re-checks).
 */
export async function runOtelExportBackfill(
  args: OtelExportBackfillArgs,
  deps: OtelExportBackfillDeps,
): Promise<OtelExportBackfillSummary> {
  const env = deps.env ?? process.env
  const deployment = resolveOtelExportDeployment(env)
  if (!args.dryRun && !deployment.enabled) return { mode: 'deployment_disabled', selected: 0 }

  const runs = await deps.selectRuns(buildOtelExportBackfillFilter(args), args.limit)
  const skipped: Partial<Record<OtelExportBackfillSkipReason, number>> = {}

  if (args.dryRun) {
    let printed = 0
    for (const run of runs) {
      const bundle = await deps.loadBundle(run.id)
      if (!bundle) {
        countSkip(skipped, 'not_found')
        continue
      }
      for (const line of buildOtelExportDryRunLines(bundle, env)) deps.writeLine(line)
      printed += 1
    }
    return { mode: 'dry_run', selected: runs.length, printed, skipped }
  }

  const settingsByTenant = new Map<string, OtelExportSettings>()
  let enqueued = 0
  for (const run of runs) {
    let settings = settingsByTenant.get(run.tenantId)
    if (!settings) {
      settings = (await readOtelExportSettings(deps.container, run.tenantId)).settings
      settingsByTenant.set(run.tenantId, settings)
    }
    const enabled = isExportEnabledFor({ deployment, tenant: settings, agentId: run.agentId, runSource: run.source })
    if (!enabled) {
      countSkip(skipped, skipReasonFor(settings, run))
      continue
    }
    await deps.enqueue({ runId: run.id, attempt: 0 }, { delayMs: 0 })
    enqueued += 1
  }
  return { mode: 'enqueue', selected: runs.length, enqueued, skipped }
}

export function formatOtelExportBackfillSkips(
  skipped: Partial<Record<OtelExportBackfillSkipReason, number>>,
): string {
  const entries = Object.entries(skipped).filter(([, count]) => (count ?? 0) > 0)
  if (entries.length === 0) return 'none'
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ')
}
