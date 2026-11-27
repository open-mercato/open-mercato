import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseProcessRecord, parseStoredState, type MaintenanceProcessRecord, type MaintenanceStateV1 } from '../state'
import type { MaintenanceStateStore, StoredStateRead } from './types'

const STATE_FILE = 'state.json'
const LOCK_FILE = 'state.lock'
const PROCESS_DIR = 'processes'
const LOCK_WAIT_MS = 3000
const LOCK_STALE_MS = 10000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isErrnoCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === code
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, target)
}

function sanitizeProcessId(processId: string): string {
  return processId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function createFileMaintenanceStore(stateDir: string): MaintenanceStateStore {
  const statePath = path.join(stateDir, STATE_FILE)
  const lockPath = path.join(stateDir, LOCK_FILE)
  const processDir = path.join(stateDir, PROCESS_DIR)

  async function ensureDirs(): Promise<void> {
    await fs.mkdir(processDir, { recursive: true, mode: 0o700 })
  }

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    await ensureDirs()
    const deadline = Date.now() + LOCK_WAIT_MS
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    while (!handle) {
      try {
        handle = await fs.open(lockPath, 'wx', 0o600)
      } catch (error) {
        if (!isErrnoCode(error, 'EEXIST')) throw error
        try {
          const stats = await fs.stat(lockPath)
          if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) await fs.rm(lockPath, { force: true })
        } catch {
          // lock vanished between attempts; retry
        }
        if (Date.now() > deadline) throw new Error('[internal] Timed out acquiring the maintenance state lock')
        await sleep(25)
      }
    }
    try {
      return await fn()
    } finally {
      await handle.close().catch(() => {})
      await fs.rm(lockPath, { force: true }).catch(() => {})
    }
  }

  async function readRaw(): Promise<StoredStateRead> {
    let content: string
    try {
      content = await fs.readFile(statePath, 'utf8')
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) return { kind: 'missing' }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return { kind: 'unsupported', reason: 'state file is not valid JSON' }
    }
    const result = parseStoredState(parsed)
    return result.kind === 'ok' ? { kind: 'ok', state: result.state } : result
  }

  return {
    kind: 'file',
    multiHost: false,
    readState: readRaw,
    async compareAndSet(expectedRevision: number, next: MaintenanceStateV1): Promise<boolean> {
      return withLock(async () => {
        const current = await readRaw()
        const currentRevision = current.kind === 'ok' ? current.state.revision : current.kind === 'missing' ? 0 : -1
        if (currentRevision !== expectedRevision) return false
        await writeAtomic(statePath, JSON.stringify(next, null, 2))
        return true
      })
    },
    async writeProcess(record: MaintenanceProcessRecord): Promise<void> {
      await ensureDirs()
      await writeAtomic(path.join(processDir, `${sanitizeProcessId(record.processId)}.json`), JSON.stringify(record))
    },
    async removeProcess(processId: string): Promise<void> {
      await fs.rm(path.join(processDir, `${sanitizeProcessId(processId)}.json`), { force: true })
    },
    async listProcesses(): Promise<MaintenanceProcessRecord[]> {
      let entries: string[]
      try {
        entries = await fs.readdir(processDir)
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) return []
        throw error
      }
      const records: MaintenanceProcessRecord[] = []
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        try {
          const record = parseProcessRecord(JSON.parse(await fs.readFile(path.join(processDir, entry), 'utf8')))
          if (record) records.push(record)
        } catch {
          continue
        }
      }
      return records
    },
    async now(): Promise<Date> {
      return new Date()
    },
    async isDurable(): Promise<boolean> {
      return true
    },
    async close(): Promise<void> {},
  }
}
