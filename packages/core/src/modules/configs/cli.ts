import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from './lib/module-config-service'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { DEFAULT_NOTIFICATION_DELIVERY_CONFIG, NOTIFICATIONS_DELIVERY_CONFIG_KEY } from '../notifications/lib/deliveryConfig'
import { Tenant } from '../directory/data/entities'
import {
  collectCacheStats,
  executeCachePurge,
  previewCachePurge,
  type CachePurgeRequest,
} from './lib/cache-cli'

type ParsedArgs = Record<string, string | boolean>

type CacheScope = {
  label: string
  tenantId: string | null
}

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

function stringOption(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function flagEnabled(args: ParsedArgs, ...keys: string[]): boolean {
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined) continue
    if (raw === true) return true
    if (typeof raw === 'string') {
      const parsed = parseBooleanToken(raw)
      return parsed === null ? true : parsed
    }
  }
  return false
}

function splitListOption(raw: string | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const values: string[] = []
  for (const item of raw.split(',')) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    values.push(trimmed)
  }
  return values
}

async function resolveCacheScopes(
  em: EntityManager,
  args: ParsedArgs,
): Promise<CacheScope[]> {
  const explicitTenantId = stringOption(args, 'tenant', 'tenantId')
  const globalOnly = flagEnabled(args, 'global')
  const allTenants = flagEnabled(args, 'all-tenants', 'allTenants')

  if (explicitTenantId && globalOnly) {
    throw new Error('Cannot combine `--tenant` with `--global`.')
  }
  if (explicitTenantId && allTenants) {
    throw new Error('Cannot combine `--tenant` with `--all-tenants`.')
  }
  if (globalOnly && allTenants) {
    throw new Error('Cannot combine `--global` with `--all-tenants`.')
  }

  if (explicitTenantId) {
    return [{ label: `tenant:${explicitTenantId}`, tenantId: explicitTenantId }]
  }

  if (globalOnly) {
    return [{ label: 'global', tenantId: null }]
  }

  if (!allTenants) {
    return [{ label: 'global', tenantId: null }]
  }

  const tenants = await em.find(Tenant, { deletedAt: null }, { orderBy: { name: 'asc' } })
  const scopes: CacheScope[] = [{ label: 'global', tenantId: null }]
  const seen = new Set<string>()
  for (const tenant of tenants) {
    const tenantId = typeof tenant.id === 'string' ? tenant.id : ''
    if (!tenantId || seen.has(tenantId)) continue
    seen.add(tenantId)
    scopes.push({ label: `tenant:${tenantId}`, tenantId })
  }
  return scopes
}

function resolveCachePurgeRequest(args: ParsedArgs): CachePurgeRequest {
  if (flagEnabled(args, 'all')) return { kind: 'all' }

  const segment = stringOption(args, 'segment')
  if (segment) return { kind: 'segment', segment }

  const tags = splitListOption(stringOption(args, 'tag', 'tags'))
  if (tags.length > 0) return { kind: 'tags', tags }

  const keys = splitListOption(stringOption(args, 'key', 'keys'))
  if (keys.length > 0) return { kind: 'keys', keys }

  const ids = splitListOption(stringOption(args, 'id', 'ids'))
  if (ids.length > 0) return { kind: 'ids', ids }

  const pattern = stringOption(args, 'pattern')
  if (pattern) return { kind: 'pattern', pattern }

  throw new Error(
    'Choose a purge target: `--all`, `--segment <id>`, `--tag <tag1,tag2>`, `--key <key1,key2>`, `--id <token1,token2>`, or `--pattern <glob>`.',
  )
}

function printCacheHelp() {
  console.log('🧹 Cache CLI')
  console.log('')
  console.log('🚀 Usage:')
  console.log('  yarn mercato configs cache stats [--tenant <id> | --global | --all-tenants] [--json]')
  console.log('  yarn mercato configs cache purge --all [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('  yarn mercato configs cache purge --segment <segment> [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('  yarn mercato configs cache purge --tag <tag1,tag2> [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('  yarn mercato configs cache purge --key <key1,key2> [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('  yarn mercato configs cache purge --id <token1,token2> [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('  yarn mercato configs cache purge --pattern <glob> [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('  yarn mercato configs cache structural [--tenant <id> | --global | --all-tenants] [--dry-run] [--json]')
  console.log('')
  console.log('ℹ️ Notes:')
  console.log('  `stats` mirrors the cache admin page segment overview for CRUD/widget caches.')
  console.log('  `purge --id` removes every key whose name contains the provided token (for example a user id or entity id).')
  console.log('  `structural` targets navigation caches (`nav:*`) and is the recommended post-step after module/sidebar structure changes.')
  console.log('  When no scope flag is supplied, this command uses the global cache scope only.')
}

async function disposeContainer(container: unknown) {
  const disposable = container as { dispose?: () => Promise<void> }
  if (typeof disposable.dispose === 'function') {
    await disposable.dispose()
  }
}

async function runCacheStats(args: ParsedArgs) {
  const json = flagEnabled(args, 'json')
  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    const cache = container.resolve('cache') as CacheStrategy
    const scopes = await resolveCacheScopes(em, args)
    const results = []
    for (const scope of scopes) {
      const stats = await runWithCacheTenant(scope.tenantId, async () => collectCacheStats(cache))
      results.push({ scope: scope.label, ...stats })
    }

    if (json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    for (const result of results) {
      console.log(`🔎 [cache] scope=${result.scope} totalKeys=${result.totalKeys} generatedAt=${result.generatedAt}`)
      if (result.segments.length === 0) {
        console.log('  ∅ segments: none')
        continue
      }
      for (const segment of result.segments) {
        console.log(`  • ${segment.segment} (${segment.keyCount})${segment.path ? ` ${segment.path}` : ''}`)
      }
    }
  } finally {
    await disposeContainer(container)
  }
}

async function runCachePurge(args: ParsedArgs) {
  const json = flagEnabled(args, 'json')
  const quiet = flagEnabled(args, 'quiet')
  const dryRun = flagEnabled(args, 'dry-run', 'dryRun')
  const request = resolveCachePurgeRequest(args)
  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    const cache = container.resolve('cache') as CacheStrategy
    const scopes = await resolveCacheScopes(em, args)
    const results = []

    for (const scope of scopes) {
      const result = await runWithCacheTenant(scope.tenantId, async () =>
        dryRun ? previewCachePurge(cache, request) : executeCachePurge(cache, request)
      )
      results.push({
        scope: scope.label,
        dryRun,
        request,
        deleted: result.deleted,
        keyCount: result.keys.length,
        keys: result.keys,
        note: result.note,
      })
    }

    if (json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    if (quiet) {
      return
    }

    for (const result of results) {
      console.log(`${result.dryRun ? '🧪' : '🧹'} [cache] scope=${result.scope} deleted=${result.deleted}${result.dryRun ? ' (dry-run)' : ''}`)
      if (result.note) console.log(`  ℹ️ note: ${result.note}`)
      if (result.keys.length > 0) {
        for (const key of result.keys) {
          console.log(`  • ${key}`)
        }
      }
    }
  } finally {
    await disposeContainer(container)
  }
}

async function runStructuralCachePurge(args: ParsedArgs) {
  const nextArgs: ParsedArgs = {
    ...args,
    pattern: 'nav:*',
  }
  await runCachePurge(nextArgs)
}

function envDisablesAutoIndexing(): boolean {
  const raw =
    process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING ??
    process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
  if (!raw) return false
  return parseBooleanToken(raw) === true
}

const restoreDefaults: ModuleCli = {
  command: 'restore-defaults',
  async run() {
    const container = await createRequestContainer()
    try {
      let service: ModuleConfigService
      try {
        service = (container.resolve('moduleConfigService') as ModuleConfigService)
      } catch {
        console.error('[configs] moduleConfigService is not registered in the container.')
        return
      }

      const disabledByEnv = envDisablesAutoIndexing()
      const defaultEnabled = !disabledByEnv
      await service.restoreDefaults(
        [
          {
            moduleId: 'vector',
            name: 'auto_index_enabled',
            value: defaultEnabled,
          },
          {
            moduleId: 'notifications',
            name: NOTIFICATIONS_DELIVERY_CONFIG_KEY,
            value: DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
          },
        ],
        { force: true },
      )
      console.log(
        `[configs] Vector auto-indexing default set to ${defaultEnabled ? 'enabled' : 'disabled'}${
          disabledByEnv
            ? ' (forced by OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING or legacy DISABLE_VECTOR_SEARCH_AUTOINDEXING)'
            : ''
        }.`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const help: ModuleCli = {
  command: 'help',
  async run() {
    console.log('⚙️ Configs CLI')
    console.log('')
    console.log('🚀 Usage: yarn mercato configs restore-defaults')
    console.log('  Ensures global module configuration defaults exist.')
    console.log('')
    printCacheHelp()
  },
}

const cacheCommand: ModuleCli = {
  command: 'cache',
  async run(rest) {
    const [subcommand, ...subRest] = rest
    const args = parseArgs(subRest)

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
      printCacheHelp()
      return
    }

    if (subcommand === 'stats') {
      await runCacheStats(args)
      return
    }

    if (subcommand === 'purge') {
      await runCachePurge(args)
      return
    }

    if (subcommand === 'structural') {
      await runStructuralCachePurge(args)
      return
    }

    throw new Error(`Unknown cache subcommand "${subcommand}".`)
  },
}

export default [restoreDefaults, cacheCommand, help]
