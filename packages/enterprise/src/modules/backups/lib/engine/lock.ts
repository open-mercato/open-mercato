import { constants } from 'node:fs'
import { hostname } from 'node:os'
import { open, lstat, readFile, unlink } from 'node:fs/promises'
import { z } from 'zod'
import { BackupError } from './errors'

const lockSchema = z.object({ runId: z.string().uuid(), host: z.string(), pid: z.number().int(), startedAt: z.string(), heartbeatAt: z.string() }).strict()
export async function acquireBackupLock(path: string, runId: string, takeOver?: string): Promise<() => Promise<void>> {
  const state = { runId, host: hostname(), pid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }
  let handle
  try { handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600) }
  catch {
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
  const lockHandle = handle
  const refresh = async () => { state.heartbeatAt = new Date().toISOString(); await lockHandle.truncate(0); await lockHandle.write(JSON.stringify(state), 0, 'utf8'); await lockHandle.sync() }
  await refresh()
  let refreshError: unknown
  let heartbeat = Promise.resolve()
  const timer = setInterval(() => { heartbeat = heartbeat.then(refresh).catch((error: unknown) => { refreshError = error }) }, 10000)
  timer.unref()
  let released = false
  return async () => {
    if (released) return
    released = true
    clearInterval(timer)
    await heartbeat
    const owned = await lstat(path).catch(() => null)
    const info = await lockHandle.stat()
    await lockHandle.close()
    if (owned && owned.ino === info.ino && owned.dev === info.dev) await unlink(path)
    if (refreshError) throw new BackupError('BACKUP_LOCK_HEARTBEAT_FAILED', 5, true)
  }
}
