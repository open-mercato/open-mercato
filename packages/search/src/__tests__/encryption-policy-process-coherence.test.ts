import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type WorkerResponse = {
  id?: number
  ready?: boolean
  ok?: boolean
  value?: unknown
}

function waitForMessage(worker: ChildProcess, predicate: (message: WorkerResponse) => boolean): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: WorkerResponse) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`[internal] Search policy worker exited with code ${String(code)}`))
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.on('exit', onExit)
  })
}

async function startWorker(statePath: string, cacheStatePath: string): Promise<ChildProcess> {
  const worker = fork(join(__dirname, 'fixtures/encryption-policy-process-worker.ts'), [], {
    execArgv: ['--import', require.resolve('tsx')],
    env: {
      ...process.env,
      SEARCH_POLICY_STATE_PATH: statePath,
      SEARCH_POLICY_CACHE_STATE_PATH: cacheStatePath,
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  await waitForMessage(worker, (message) => message.ready === true)
  return worker
}

let commandId = 0

async function resolvePolicy(worker: ChildProcess, entityId: string) {
  const id = ++commandId
  const response = waitForMessage(worker, (message) => message.id === id)
  worker.send({ id, entityId })
  return response
}

describe('Search encryption policy coherence across processes', () => {
  it('re-reads positive policy after mutation, failed publication, and cache recovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'om-search-policy-'))
    const statePath = join(directory, 'policy.json')
    const cacheStatePath = join(directory, 'cache.json')
    const entityId = 'demo:process_policy'
    let worker: ChildProcess | undefined
    try {
      await writeFile(statePath, JSON.stringify([{
        id: 'map',
        tenant_id: 'tenant-1',
        organization_id: 'org-1',
        created_at: '2026-01-01T00:00:00.000Z',
        fields_json: [{ field: 'old_secret' }],
      }]))
      await writeFile(cacheStatePath, JSON.stringify({ available: true, version: 'version-1' }))
      worker = await startWorker(statePath, cacheStatePath)

      await expect(resolvePolicy(worker, entityId)).resolves.toMatchObject({
        ok: true,
        value: [{ field: 'old_secret', hashField: null }],
      })

      await writeFile(statePath, JSON.stringify([{
        id: 'map',
        tenant_id: 'tenant-1',
        organization_id: 'org-1',
        created_at: '2026-01-01T00:00:00.000Z',
        fields_json: [{ field: 'old_secret' }, { field: 'new_secret' }],
      }]))
      await writeFile(cacheStatePath, JSON.stringify({ available: false, version: 'version-1' }))
      await expect(resolvePolicy(worker, entityId)).resolves.toMatchObject({
        ok: true,
        value: [
          { field: 'old_secret', hashField: null },
          { field: 'new_secret', hashField: null },
        ],
      })

      await writeFile(cacheStatePath, JSON.stringify({ available: true, version: 'version-2' }))
      await expect(resolvePolicy(worker, entityId)).resolves.toMatchObject({
        ok: true,
        value: [
          { field: 'old_secret', hashField: null },
          { field: 'new_secret', hashField: null },
        ],
      })
    } finally {
      worker?.kill()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
