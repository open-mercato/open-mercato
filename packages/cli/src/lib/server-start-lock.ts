import fs from 'node:fs'
import path from 'node:path'

type ServerStartLockRecord = {
  pid: number
  port: string | null
  startedAt: string
  processStartTime: string | null
  bootId: string | null
}

export type ServerStartLockHandle = {
  lockPath: string
  release: () => void
}

const BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id'
const STAT_FIRST_FIELD_AFTER_COMMAND = 3
const STAT_START_TIME_FIELD = 22

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readServerStartLock(lockPath: string): ServerStartLockRecord | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ServerStartLockRecord>
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null
    }
    return {
      pid: parsed.pid,
      port: typeof parsed.port === 'string' && parsed.port.trim().length > 0 ? parsed.port : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      processStartTime: readOptionalString(parsed.processStartTime),
      bootId: readOptionalString(parsed.bootId),
    }
  } catch {
    return null
  }
}

/**
 * Reads the start time of `pid` (field 22 of `/proc/<pid>/stat`). The command name
 * in field 2 may contain spaces or parentheses, so only the text after the last `)`
 * is split. Returns `null` when the platform has no `/proc` (macOS, Windows) or the
 * entry cannot be read or parsed.
 */
export function readProcessStartTime(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')
    if (commandEnd < 0) return null
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/)
    const startTime = fields[STAT_START_TIME_FIELD - STAT_FIRST_FIELD_AFTER_COMMAND]
    return startTime && /^\d+$/.test(startTime) ? startTime : null
  } catch {
    return null
  }
}

function readBootId(): string | null {
  try {
    return readOptionalString(fs.readFileSync(BOOT_ID_PATH, 'utf8'))
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * A lock is held only while the process that wrote it is still running. A live pid
 * alone is not enough: the lock file sits in the app directory and survives a
 * container restart, while pid numbering starts again, so the recorded pid soon
 * belongs to an unrelated process. When the lock carries the boot id and the
 * process start time, both must still match. When either side cannot be read
 * (old lock format, no `/proc`), the pid check alone decides, as before.
 */
function isLockOwnerAlive(lock: ServerStartLockRecord): boolean {
  if (!isProcessAlive(lock.pid)) return false

  if (lock.bootId) {
    const currentBootId = readBootId()
    if (currentBootId && currentBootId !== lock.bootId) return false
  }

  if (lock.processStartTime) {
    const currentStartTime = readProcessStartTime(lock.pid)
    if (currentStartTime && currentStartTime !== lock.processStartTime) return false
  }

  return true
}

export function getServerStartLockPath(appDir: string): string {
  return path.join(appDir, '.mercato', 'server-start.lock')
}

export function acquireServerStartLock(
  appDir: string,
  options: { port?: string | null } = {},
): ServerStartLockHandle {
  const lockPath = getServerStartLockPath(appDir)
  const lockRecord: ServerStartLockRecord = {
    pid: process.pid,
    port: typeof options.port === 'string' && options.port.trim().length > 0 ? options.port.trim() : null,
    startedAt: new Date().toISOString(),
    processStartTime: readProcessStartTime(process.pid),
    bootId: readBootId(),
  }

  fs.mkdirSync(path.dirname(lockPath), { recursive: true })

  for (;;) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(lockRecord), { encoding: 'utf8', flag: 'wx' })
      break
    } catch (error) {
      const writeError = error as NodeJS.ErrnoException
      if (writeError.code !== 'EEXIST') {
        throw writeError
      }

      const existingLock = readServerStartLock(lockPath)
      if (existingLock && existingLock.pid !== process.pid && isLockOwnerAlive(existingLock)) {
        const portSuffix = existingLock.port ? ` on port ${existingLock.port}` : ''
        throw new Error(
          `[server] Another Open Mercato production server is already running for ${appDir} (pid ${existingLock.pid}${portSuffix}). Stop it before starting another instance.`,
        )
      }

      fs.rmSync(lockPath, { force: true })
    }
  }

  let released = false
  const release = () => {
    if (released) return
    released = true

    const currentLock = readServerStartLock(lockPath)
    if (currentLock?.pid === process.pid) {
      fs.rmSync(lockPath, { force: true })
    }
  }

  process.once('exit', release)

  return {
    lockPath,
    release,
  }
}
