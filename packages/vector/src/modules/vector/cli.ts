import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
import type { VectorIndexService } from '@open-mercato/vector'
import type { EntityManager } from '@mikro-orm/postgresql'
import { reindexEntity, DEFAULT_REINDEX_PARTITIONS } from '@open-mercato/core/modules/query_index/lib/reindexer'

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

function numberOpt(args: ParsedArgs, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return parsed
    }
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
      if (['1', 'true', 'yes', 'y', ''].includes(normalized)) return true
      if (['0', 'false', 'no', 'n'].includes(normalized)) return false
      return true
    }
  }
  return undefined
}

function toPositiveInt(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

function toNonNegativeInt(value: number | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

async function reindexCommand(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const tenantId = stringOpt(args, 'tenant', 'tenantId')
  const organizationId = stringOpt(args, 'org', 'orgId', 'organizationId')
  const entityId = stringOpt(args, 'entity', 'entityId')
  const force = flagOpt(args, 'force', 'full') === true
  const batchSize = toPositiveInt(numberOpt(args, 'batch', 'chunk', 'size'))
  const partitionsOption = toPositiveInt(numberOpt(args, 'partitions', 'partitionCount', 'parallel'))
  const partitionIndexRaw = numberOpt(args, 'partition', 'partitionIndex')
  const partitionIndexOption = partitionIndexRaw === undefined ? undefined : toNonNegativeInt(partitionIndexRaw, 0)
  const resetCoverageFlag = flagOpt(args, 'resetCoverage') === true
  const skipResetCoverageFlag = flagOpt(args, 'skipResetCoverage', 'noResetCoverage') === true
  const skipPurgeFlag = flagOpt(args, 'skipPurge', 'noPurge') === true
  const purgeFlag = flagOpt(args, 'purge', 'purgeFirst')

  const container = await createRequestContainer()
  let baseEm: EntityManager | null = null
  try {
    baseEm = container.resolve<EntityManager>('em')
  } catch {
    baseEm = null
  }

  const disposeContainer = async () => {
    if (typeof (container as any)?.dispose === 'function') {
      await (container as any).dispose()
    }
  }

  const recordError = async (error: Error) => recordIndexerError(
    { em: baseEm ?? undefined },
    {
      source: 'vector',
      handler: 'cli:vector.reindex',
      error,
      entityType: entityId ?? null,
      tenantId: tenantId ?? null,
      organizationId: organizationId ?? null,
      payload: {
        args,
        force,
        batchSize,
        partitionsOption,
        partitionIndexOption,
        resetCoverageFlag,
        skipResetCoverageFlag,
        skipPurgeFlag,
        purgeFlag,
      },
    },
  )

  try {
    const service = container.resolve<VectorIndexService>('vectorIndexService')
    await service.ensureDriverReady()
    const enabledEntities = new Set(service.listEnabledEntities())
    const baseEventBus = (() => {
      try {
        return container.resolve('eventBus') as {
          emitEvent(event: string, payload: any, options?: any): Promise<void>
        }
      } catch {
        return null
      }
    })()
    if (!baseEventBus) {
      console.warn('[vector.cli] eventBus unavailable; vector embeddings may not be refreshed. Run bootstrap or ensure event bus configuration.')
    }

    const partitionCount = Math.max(1, partitionsOption ?? DEFAULT_REINDEX_PARTITIONS)
    if (partitionIndexOption !== undefined && partitionIndexOption >= partitionCount) {
      console.error(`partitionIndex (${partitionIndexOption}) must be < partitionCount (${partitionCount})`)
      return
    }
    const partitionTargets =
      partitionIndexOption !== undefined
        ? [partitionIndexOption]
        : Array.from({ length: partitionCount }, (_, idx) => idx)

    const shouldResetCoverage = (partition: number): boolean => {
      if (resetCoverageFlag) return true
      if (skipResetCoverageFlag) return false
      if (partitionIndexOption !== undefined) return partitionIndexOption === 0
      return partition === partitionTargets[0]
    }

    const runReindex = async (entityType: string, purgeFirst: boolean) => {
      const scopeLabel = tenantId
        ? `tenant=${tenantId}${organizationId ? `, org=${organizationId}` : ''}`
        : 'all tenants'
      console.log(`Reindexing vectors for ${entityType} (${scopeLabel})${purgeFirst ? ' [purge]' : ''}`)

      if (purgeFirst && tenantId) {
        try {
          console.log('  -> purging existing vector index rows...')
          await service.purgeIndex({ tenantId, organizationId: organizationId ?? null, entityId: entityType })
        } catch (err) {
          console.warn('  -> purge failed, continuing with reindex', err instanceof Error ? err.message : err)
        }
      } else if (purgeFirst && !tenantId) {
        console.warn('  -> skipping purge: tenant scope not provided')
      }

      const progressState = new Map<number, { last: number }>()
      const renderProgress = (part: number, info: { processed: number; total: number }) => {
        const state = progressState.get(part) ?? { last: 0 }
        const now = Date.now()
        if (now - state.last < 1000 && info.processed < info.total) return
        state.last = now
        progressState.set(part, state)
        const percent = info.total > 0 ? ((info.processed / info.total) * 100).toFixed(2) : '0.00'
        console.log(
          `     [${entityType}] partition ${part + 1}/${partitionCount}: ${info.processed.toLocaleString()} / ${info.total.toLocaleString()} (${percent}%)`,
        )
      }

      const processed = await Promise.all(
        partitionTargets.map(async (part, idx) => {
          const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
          if (partitionTargets.length === 1) {
            console.log(`  -> processing${label}`)
          } else if (idx === 0) {
            console.log(`  -> processing partitions in parallel (count=${partitionTargets.length})`)
          }

          const partitionContainer = await createRequestContainer()
          const partitionEm = partitionContainer.resolve<EntityManager>('em')
          try {
            let progressBar: ReturnType<typeof createProgressBar> | null = null
            const useBar = partitionTargets.length === 1
            const stats = await reindexEntity(partitionEm, {
              entityType,
              tenantId: tenantId ?? undefined,
              organizationId: organizationId ?? null,
              force,
              batchSize,
              eventBus: baseEventBus ?? undefined,
              emitVectorizeEvents: true,
              partitionCount,
              partitionIndex: part,
              resetCoverage: shouldResetCoverage(part),
              onProgress(info) {
                if (useBar) {
                  if (info.total > 0 && !progressBar) {
                    progressBar = createProgressBar(`Reindexing ${entityType}${label}`, info.total)
                  }
                  progressBar?.update(info.processed)
                } else {
                  renderProgress(part, info)
                }
              },
            })
            progressBar?.complete()
            if (!useBar) {
              renderProgress(part, { processed: stats.processed, total: stats.total })
            } else {
              console.log(
                `     processed ${stats.processed} row(s)${stats.total ? ` (base ${stats.total})` : ''}`,
              )
            }
            return stats.processed
          } finally {
            if (typeof (partitionContainer as any)?.dispose === 'function') {
              await (partitionContainer as any).dispose()
            }
          }
        }),
      )

      const totalProcessed = processed.reduce((acc, value) => acc + value, 0)
      console.log(`Finished ${entityType}: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
      return totalProcessed
    }

    const defaultPurge = purgeFlag === true && !skipPurgeFlag

    if (entityId) {
      if (!enabledEntities.has(entityId)) {
        console.error(`Entity ${entityId} is not enabled for vector search.`)
        return
      }
      const purgeFirst = defaultPurge
      await service.ensureDriverReady(entityId)
      await runReindex(entityId, purgeFirst)
      console.log('Vector reindex completed.')
      return
    }

    const entityIds = service.listEnabledEntities()
    if (!entityIds.length) {
      console.log('No entities enabled for vector search.')
      return
    }
    console.log(`Reindexing ${entityIds.length} vector-enabled entities...`)
    let processedOverall = 0
    for (let idx = 0; idx < entityIds.length; idx += 1) {
      const id = entityIds[idx]!
      console.log(`[${idx + 1}/${entityIds.length}] Preparing ${id}...`)
      await service.ensureDriverReady(id)
      processedOverall += await runReindex(id, defaultPurge)
    }
    console.log(`Vector reindex completed. Total processed rows: ${processedOverall.toLocaleString()}`)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error('[vector.cli] Reindex failed:', err.stack ?? err.message)
    await recordError(err)
    throw err
  } finally {
    await disposeContainer()
  }
}

const reindexCli: ModuleCli = {
  command: 'reindex',
  async run(rest) {
    await reindexCommand(rest)
  },
}

const helpCli: ModuleCli = {
  command: 'help',
  async run() {
    console.log('Usage: yarn mercato vector reindex [options]')
    console.log('  --tenant <id>           Optional tenant scope (required for purge & coverage).')
    console.log('  --org <id>              Optional organization scope (requires tenant).')
    console.log('  --entity <module:entity> Reindex a single entity (defaults to all enabled entities).')
    console.log('  --partitions <n>        Number of partitions to process in parallel (default from query index).')
    console.log('  --partition <idx>       Restrict to a specific partition index.')
    console.log('  --batch <n>             Override batch size per chunk.')
    console.log('  --force                 Force reindex even if another job is running.')
    console.log('  --purgeFirst            Purge vector rows before reindexing (defaults to skip).')
    console.log('  --skipPurge             Explicitly skip purging vector rows.')
    console.log('  --skipResetCoverage     Keep existing coverage snapshots.')
  },
}

export default [reindexCli, helpCli]
