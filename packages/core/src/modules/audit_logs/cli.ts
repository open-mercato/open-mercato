import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import {
  AccessLogService,
  resolveAccessLogRetentionBatchSize,
  resolveAccessLogRetentionDays,
} from '@open-mercato/core/modules/audit_logs/services/accessLogService'

function parseArgs(rest: string[]) {
  const args: Record<string, string | boolean> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg || !arg.startsWith('--')) continue

    const [key, inlineValue] = arg.replace(/^--/, '').split('=')
    if (inlineValue !== undefined) {
      args[key] = inlineValue
      continue
    }

    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
      continue
    }

    args[key] = true
  }

  return args
}

function parsePositiveInt(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const projectionsBackfill: ModuleCli = {
  command: 'projections:backfill',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = typeof args.tenantId === 'string' ? args.tenantId : typeof args.tenant === 'string' ? args.tenant : null
    const organizationId = typeof args.organizationId === 'string'
      ? args.organizationId
      : typeof args.orgId === 'string'
        ? args.orgId
        : typeof args.org === 'string'
          ? args.org
          : null
    const batchSize = parsePositiveInt(args.batchSize ?? args.batch, 250)
    const force = parseBooleanToken(
      typeof args.force === 'boolean' ? 'true' : typeof args.force === 'string' ? args.force : null,
    ) === true

    const container = await createRequestContainer()
    const actionLogService = container.resolve('actionLogService') as ActionLogService

    console.log(
      `[backfill] Starting audit log projection backfill (tenant=${tenantId ?? 'all'}, org=${organizationId ?? 'all'}, batch=${batchSize}, force=${force})`,
    )

    const result = await actionLogService.backfillProjections({
      batchSize,
      force,
      logger: (message) => console.log(message),
      organizationId,
      tenantId,
    })

    console.log('[backfill] Complete.')
    console.log(`  Scanned: ${result.scanned}`)
    console.log(`  Updated: ${result.updated}`)
    console.log(`  Skipped: ${result.skipped}`)
    console.log(`  Errors: ${result.errors}`)
  },
}

const sensitiveDataRedact: ModuleCli = {
  command: 'sensitive-data:redact',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = typeof args.tenantId === 'string' ? args.tenantId : typeof args.tenant === 'string' ? args.tenant : null
    const organizationId = typeof args.organizationId === 'string'
      ? args.organizationId
      : typeof args.orgId === 'string'
        ? args.orgId
        : typeof args.org === 'string'
          ? args.org
          : null
    const batchSize = parsePositiveInt(args.batchSize ?? args.batch, 250)
    const dryRun = parseBooleanToken(
      typeof args.dryRun === 'boolean'
        ? 'true'
        : typeof args.dryRun === 'string'
          ? args.dryRun
          : typeof args['dry-run'] === 'boolean'
            ? 'true'
            : typeof args['dry-run'] === 'string'
              ? args['dry-run']
              : null,
    ) === true

    const container = await createRequestContainer()
    const actionLogService = container.resolve('actionLogService') as ActionLogService

    console.log(
      `[sensitive-data:redact] Starting audit log cleanup (tenant=${tenantId ?? 'all'}, org=${organizationId ?? 'all'}, batch=${batchSize}, dryRun=${dryRun})`,
    )

    const result = await actionLogService.redactSensitiveHistory({
      batchSize,
      dryRun,
      logger: (message) => console.log(message),
      organizationId,
      tenantId,
    })

    console.log('[sensitive-data:redact] Complete.')
    console.log(`  Scanned: ${result.scanned}`)
    console.log(`  Updated: ${result.updated}`)
    console.log(`  Would update: ${result.wouldUpdate}`)
    console.log(`  Skipped: ${result.skipped}`)
    console.log(`  Errors: ${result.errors}`)
    if (result.errors > 0) {
      throw new Error(`[internal] Audit log cleanup failed for ${result.errors} row(s)`)
    }
  },
}

const accessRetentionPrune: ModuleCli = {
  command: 'access-retention:prune',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = typeof args.tenantId === 'string' ? args.tenantId : typeof args.tenant === 'string' ? args.tenant : undefined
    const organizationId = typeof args.organizationId === 'string'
      ? args.organizationId
      : typeof args.orgId === 'string'
        ? args.orgId
        : typeof args.org === 'string'
          ? args.org
          : undefined
    const accessClassRaw = typeof args.class === 'string' ? args.class : 'all'
    if (!['all', 'core', 'non_core'].includes(accessClassRaw)) {
      throw new Error('[internal] Access-log retention class must be all, core, or non_core')
    }
    const accessClass = accessClassRaw as 'all' | 'core' | 'non_core'
    const batchSize = parsePositiveInt(args.batchSize ?? args.batch, resolveAccessLogRetentionBatchSize())
    const retentionDays = parsePositiveInt(
      args.retentionDays ?? args['retention-days'],
      resolveAccessLogRetentionDays(accessClass),
    )
    const dryRun = parseBooleanToken(
      typeof args.dryRun === 'boolean'
        ? 'true'
        : typeof args.dryRun === 'string'
          ? args.dryRun
          : typeof args['dry-run'] === 'boolean'
            ? 'true'
            : typeof args['dry-run'] === 'string'
              ? args['dry-run']
              : null,
    ) === true
    const allScopes = parseBooleanToken(
      typeof args.allScopes === 'boolean'
        ? 'true'
        : typeof args.allScopes === 'string'
          ? args.allScopes
          : typeof args['all-scopes'] === 'boolean'
            ? 'true'
            : typeof args['all-scopes'] === 'string'
              ? args['all-scopes']
              : null,
    ) === true

    const container = await createRequestContainer()
    const service = container.resolve('accessLogService') as AccessLogService
    let deleted = 0
    let result = await service.applyRetention({
      accessClass,
      allScopes,
      batchSize,
      dryRun,
      organizationId,
      retentionDays,
      tenantId,
    })
    deleted += result.deleted

    while (!dryRun && result.deleted >= result.batchSize) {
      result = await service.applyRetention({
        accessClass,
        allScopes,
        batchSize,
        dryRun: false,
        organizationId,
        retentionDays,
        tenantId,
      })
      deleted += result.deleted
    }

    console.log('[access-retention:prune] Complete.')
    console.log(`  Scope: tenant=${tenantId ?? 'all'}, org=${organizationId ?? 'all'}`)
    console.log(`  Class: ${accessClass}`)
    console.log(`  Retention days: ${retentionDays}`)
    console.log(`  Dry run: ${dryRun}`)
    console.log(`  Matched: ${dryRun ? result.matched : deleted}`)
    console.log(`  Deleted: ${deleted}`)
  },
}

const cliCommands = [projectionsBackfill, sensitiveDataRedact, accessRetentionPrune]

export default cliCommands
