import { constants } from 'node:fs'
import { hostname } from 'node:os'
import { open, lstat, readFile, unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { BackupError } from './errors'

const lockSchema = z.object({ runId: z.string().uuid(), host: z.string(), pid: z.number().int(), startedAt: z.string(), heartbeatAt: z.string() }).strict()
async function withBackupLockGuard<Result>(path: string, runId: string, work: () => Promise<Result>, waitForOwner = false): Promise<Result> {
  const guardPath = `${path}.guard`
  let guard
  for (let attempt = 0; !guard; attempt++) {
    try { guard = await open(guardPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!waitForOwner || attempt >= 49) throw new BackupError('BACKUP_LIVE_LOCK', 3)
      await delay(10)
    }
  }
  let identity: { ino: number; dev: number } | undefined
  try {
    identity = await guard.stat()
    await guard.writeFile(JSON.stringify({ runId, host: hostname(), pid: process.pid, startedAt: new Date().toISOString() }))
    await guard.sync()
    return await work()
  } finally {
    await guard.close()
    const current = await lstat(guardPath).catch(() => null)
    if (identity && current?.ino === identity.ino && current.dev === identity.dev) await unlink(guardPath)
  }
}

export async function acquireBackupLock(path: string, runId: string, takeOver?: string): Promise<() => Promise<void>> {
  const state = { runId, host: hostname(), pid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }
  let pendingHandle: Awaited<ReturnType<typeof open>> | undefined
  const lockHandle = await withBackupLockGuard(path, runId, async () => {
    let handle
    try { handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new BackupError('BACKUP_LIVE_LOCK', 3)
      const previous = lockSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      let alive = true
      if (previous.host === hostname()) {
        try { process.kill(previous.pid, 0) } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
      }
      const stale = previous.host === hostname() && !alive && Date.now() - Date.parse(previous.heartbeatAt) > 60000
      if (!stale && takeOver !== previous.runId) throw new BackupError('BACKUP_LIVE_LOCK', 3)
      const still = await lstat(path)
      if (still.ino !== info.ino || still.dev !== info.dev) throw new BackupError('BACKUP_LIVE_LOCK', 3)
      await unlink(path)
      handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
    }
    pendingHandle = handle
    await handle.writeFile(JSON.stringify(state))
    await handle.sync()
    return handle
  }).catch(async (error: unknown) => {
    await pendingHandle?.close()
    throw error
  })
  const refresh = async () => { state.heartbeatAt = new Date().toISOString(); await lockHandle.truncate(0); await lockHandle.write(JSON.stringify(state), 0, 'utf8'); await lockHandle.sync() }
  let refreshError: unknown
  let heartbeat = Promise.resolve()
  const timer = setInterval(() => { heartbeat = heartbeat.then(refresh).catch((error: unknown) => { refreshError = error }) }, 10000)
  timer.unref()
  let released = false
  return async () => {
    if (released) return
    clearInterval(timer)
    await heartbeat
    try {
      if (await lstat(path).catch(() => null)) {
        await withBackupLockGuard(path, runId, async () => {
          const owned = await lstat(path).catch(() => null)
          const info = await lockHandle.stat()
          if (owned && owned.ino === info.ino && owned.dev === info.dev) await unlink(path)
        }, true)
      }
    } finally {
      released = true
      await lockHandle.close()
    }
    if (refreshError) throw new BackupError('BACKUP_LOCK_HEARTBEAT_FAILED', 5, true)
  }
}
