import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type WorkerResponse = {
  id?: number
  ready?: boolean
  exactReadBlocked?: boolean
  ok?: boolean
  value?: unknown
  error?: string
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
      reject(new Error(`[internal] Policy worker exited with code ${String(code)}`))
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.on('exit', onExit)
  })
}

async function startWorker(
  statePath: string,
  cacheFailurePath: string,
  exactReadBlockPath: string,
): Promise<ChildProcess> {
  const worker = fork(join(__dirname, 'fixtures/policy-process-worker.ts'), [], {
    execArgv: ['--import', require.resolve('tsx')],
    env: {
      ...process.env,
      TENANT_DATA_ENCRYPTION: 'yes',
      ENCRYPTION_POLICY_STATE_PATH: statePath,
      ENCRYPTION_POLICY_CACHE_FAILURE_PATH: cacheFailurePath,
      ENCRYPTION_POLICY_EXACT_BLOCK_PATH: exactReadBlockPath,
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  await waitForMessage(worker, (message) => message.ready === true)
  return worker
}

let commandId = 0

async function runCommand(worker: ChildProcess, action: 'readExact' | 'readAggregate' | 'invalidate') {
  const id = ++commandId
  const response = waitForMessage(worker, (message) => message.id === id)
  worker.send({ id, action })
  return response
}

describe('encryption policy coherence across processes', () => {
  it('re-reads exact and aggregate policy after a remote commit while the shared cache is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'om-encryption-policy-'))
    const statePath = join(directory, 'policy.json')
    const cacheFailurePath = join(directory, 'cache-status.txt')
    const exactReadBlockPath = join(directory, 'exact-read-block.txt')
    const workers: ChildProcess[] = []
    try {
      await writeFile(statePath, JSON.stringify({
        exact: [{ field: 'stale_exact' }],
        aggregate: [{ field: 'stale_aggregate' }],
      }))
      await writeFile(cacheFailurePath, 'available')
      await writeFile(exactReadBlockPath, 'released')
      const reader = await startWorker(statePath, cacheFailurePath, exactReadBlockPath)
      const invalidator = await startWorker(statePath, cacheFailurePath, exactReadBlockPath)
      workers.push(reader, invalidator)

      await expect(runCommand(reader, 'readExact')).resolves.toMatchObject({
        ok: true,
        value: ['stale_exact'],
      })
      await expect(runCommand(reader, 'readAggregate')).resolves.toMatchObject({
        ok: true,
        value: ['stale_aggregate'],
      })

      await writeFile(exactReadBlockPath, 'blocked')
      const exactReadBlocked = waitForMessage(reader, (message) => message.exactReadBlocked === true)
      const blockedPreCommitRead = runCommand(reader, 'readExact')
      await exactReadBlocked

      await writeFile(statePath, JSON.stringify({
        exact: [{ field: 'fresh_exact' }],
        aggregate: [{ field: 'fresh_aggregate' }],
      }))
      await writeFile(cacheFailurePath, 'unavailable')
      await expect(runCommand(invalidator, 'invalidate')).resolves.toMatchObject({ ok: true })

      await expect(runCommand(reader, 'readExact')).resolves.toMatchObject({
        ok: true,
        value: ['fresh_exact'],
      })
      await expect(runCommand(reader, 'readAggregate')).resolves.toMatchObject({
        ok: true,
        value: ['fresh_aggregate'],
      })
      await writeFile(exactReadBlockPath, 'released')
      await expect(blockedPreCommitRead).resolves.toMatchObject({
        ok: true,
        value: ['stale_exact'],
      })

      await writeFile(cacheFailurePath, 'available')
      await expect(runCommand(invalidator, 'invalidate')).resolves.toMatchObject({ ok: true })
      await expect(runCommand(reader, 'readExact')).resolves.toMatchObject({
        ok: true,
        value: ['fresh_exact'],
      })
    } finally {
      for (const worker of workers) worker.kill()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
