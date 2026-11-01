import { readFile } from 'node:fs/promises'
import { createEncryptionMapResolver } from '../../lib/encryption-map-resolver'

type WorkerCommand = {
  id: number
  entityId: string
}

const statePath = process.env.SEARCH_POLICY_STATE_PATH
const cacheStatePath = process.env.SEARCH_POLICY_CACHE_STATE_PATH

if (!statePath || !cacheStatePath) {
  throw new Error('[internal] Search policy fixture paths are required')
}

const query: Record<string, unknown> = {}
for (const method of ['select', 'where', 'orderBy']) {
  query[method] = () => query
}
query.execute = async () => JSON.parse(await readFile(statePath, 'utf8')) as unknown[]

const legacyPolicyVersionCache = {
  get: async () => {
    const state = JSON.parse(await readFile(cacheStatePath, 'utf8')) as {
      available: boolean
      version: string
    }
    if (!state.available) throw new Error('policy version cache unavailable')
    return state.version
  },
}

const resolveMap = createEncryptionMapResolver(
  { selectFrom: () => query } as never,
  legacyPolicyVersionCache,
)

process.on('message', async (command: WorkerCommand) => {
  try {
    const value = await resolveMap(command.entityId as never)
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
