import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

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

export default [projectionsBackfill]
