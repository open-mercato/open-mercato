import fs from 'node:fs'
import path from 'node:path'

type ServerStartLockRecord = {
  pid: number
  port: string | null
  startedAt: string
}

export type ServerStartLockHandle = {
  lockPath: string
  release: () => void
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
    }
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
      if (existingLock && existingLock.pid !== process.pid && isProcessAlive(existingLock.pid)) {
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
