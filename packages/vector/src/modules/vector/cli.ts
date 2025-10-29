import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { VectorIndexService } from '@open-mercato/vector'

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
    } else if (i + 1 < rest.length && !rest[i + 1]!.startsWith('--')) {
      args[rawKey] = rest[i + 1]!
      i += 1
    } else {
      args[rawKey] = true
    }
  }
  return args
}

function stringOpt(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function flagOpt(args: ParsedArgs, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined) continue
    if (raw === true) return true
    if (raw === false) return false
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase()
      if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
      if (['0', 'false', 'no', 'n'].includes(normalized)) return false
      return true
    }
  }
  return undefined
}

async function reindexCommand(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const tenantId = stringOpt(args, 'tenant', 'tenantId')
  if (!tenantId) {
    console.error('Missing tenant scope. Use --tenant <tenantId>.')
    return
  }
  const organizationId = stringOpt(args, 'org', 'orgId', 'organizationId')
  const entityId = stringOpt(args, 'entity', 'entityId')
  const purgeFirst = flagOpt(args, 'purge', 'purgeFirst') !== false

  const container = await createRequestContainer()
  const service = container.resolve<VectorIndexService>('vectorIndexService')

  if (entityId) {
    console.log(`Reindexing vectors for ${entityId} (tenant=${tenantId}${organizationId ? `, org=${organizationId}` : ''})${purgeFirst ? ' [purge]' : ''}`)
    await service.reindexEntity({
      entityId,
      tenantId,
      organizationId: organizationId ?? null,
      purgeFirst,
    })
  } else {
    console.log(`Reindexing all vector-enabled entities for tenant ${tenantId}${organizationId ? ` (org=${organizationId})` : ''}${purgeFirst ? ' [purge]' : ''}`)
    await service.reindexAll({
      tenantId,
      organizationId: organizationId ?? null,
      purgeFirst,
    })
  }

  console.log('Vector reindex completed.')
}

const cli: ModuleCli = {
  command: 'vector',
  async run(argv) {
    const [sub, ...rest] = argv
    switch (sub) {
      case 'reindex':
      case 'rebuild':
        await reindexCommand(rest)
        return
      case 'help':
      case undefined:
        console.log('Usage: yarn mercato vector reindex --tenant <tenantId> [--org <orgId>] [--entity <module:entity>] [--purgeFirst=false]')
        return
      default:
        console.error(`Unknown vector subcommand: ${sub}`)
        console.log('Available subcommands: reindex')
    }
  },
}

export default cli
