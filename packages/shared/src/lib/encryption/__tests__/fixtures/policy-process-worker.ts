import { readFile } from 'node:fs/promises'
import { TenantDataEncryptionService } from '../../tenantDataEncryptionService'

type PolicyState = {
  exact: Array<{ field: string }>
  aggregate: Array<{ field: string }>
}

type WorkerCommand = {
  id: number
  action: 'readExact' | 'readAggregate' | 'invalidate'
}

const entityId = 'test:process_policy'
const tenantId = 'tenant-process-policy'
const organizationId = 'org-process-policy'
const statePath = process.env.ENCRYPTION_POLICY_STATE_PATH
const cacheFailurePath = process.env.ENCRYPTION_POLICY_CACHE_FAILURE_PATH
const exactReadBlockPath = process.env.ENCRYPTION_POLICY_EXACT_BLOCK_PATH

if (!statePath || !cacheFailurePath || !exactReadBlockPath) {
  throw new Error('[internal] Process policy fixture paths are required')
}

async function readPolicyState(): Promise<PolicyState> {
  return JSON.parse(await readFile(statePath, 'utf8')) as PolicyState
}

async function cacheIsUnavailable(): Promise<boolean> {
  return (await readFile(cacheFailurePath, 'utf8')).trim() === 'unavailable'
}

let hasBlockedExactRead = false

const execute = async (_sql: string, params: readonly unknown[] = []) => {
  const state = await readPolicyState()
  if (params.length === 2) return [{ fields_json: state.aggregate }]
  if (params[2] === organizationId) {
    if (!hasBlockedExactRead && (await readFile(exactReadBlockPath, 'utf8')).trim() === 'blocked') {
      hasBlockedExactRead = true
      process.send?.({ exactReadBlocked: true })
      while ((await readFile(exactReadBlockPath, 'utf8')).trim() === 'blocked') {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    return [{ entity_id: entityId, fields_json: state.exact }]
  }
  return []
}

const cache = {
  get: async () => ({ entityId, fields: [{ field: 'stale_shared_cache' }] }),
  set: async () => {
    if (await cacheIsUnavailable()) throw new Error('cache publication failed')
  },
  delete: async () => {
    if (await cacheIsUnavailable()) throw new Error('cache invalidation failed')
    return true
  },
}

const service = new TenantDataEncryptionService(
  { execute, getConnection: () => ({ execute }) } as never,
  {
    cache: cache as never,
    kms: {
      getTenantDek: async () => null,
      createTenantDek: async () => null,
      isHealthy: () => true,
    },
  } as never,
)

process.on('message', async (command: WorkerCommand) => {
  try {
    const value = command.action === 'readExact'
      ? await service.getEncryptedFieldNames(entityId, tenantId, organizationId)
      : command.action === 'readAggregate'
        ? await service.getEncryptedFieldNames(entityId, tenantId, null)
        : await service.invalidateMap(entityId, tenantId, organizationId)
    process.send?.({ id: command.id, ok: true, value })
  } catch (error) {
    process.send?.({
      id: command.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

process.send?.({ ready: true })
