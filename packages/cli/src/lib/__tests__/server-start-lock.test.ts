import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  acquireServerStartLock,
  getServerStartLockPath,
} from '../server-start-lock'

describe('server start lock', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-server-lock-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates and removes the lock for the current process', () => {
    const handle = acquireServerStartLock(tempDir, { port: '5001' })
    const lockPath = getServerStartLockPath(tempDir)

    expect(fs.existsSync(lockPath)).toBe(true)
    const raw = fs.readFileSync(lockPath, 'utf8')
    expect(raw).toContain(`"pid":${process.pid}`)
    expect(raw).toContain('"port":"5001"')

    handle.release()

    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('replaces a stale lock file', () => {
    const lockPath = getServerStartLockPath(tempDir)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      port: '5001',
      startedAt: new Date(0).toISOString(),
    }))

    const handle = acquireServerStartLock(tempDir, { port: '5002' })

    const raw = fs.readFileSync(lockPath, 'utf8')
    expect(raw).toContain(`"pid":${process.pid}`)
    expect(raw).toContain('"port":"5002"')

    handle.release()
  })

  it('refuses to replace a live foreign lock', () => {
    const lockPath = getServerStartLockPath(tempDir)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.ppid,
      port: '5001',
      startedAt: new Date().toISOString(),
    }))

    expect(() => acquireServerStartLock(tempDir, { port: '5002' })).toThrow(
      `Another Open Mercato production server is already running for ${tempDir}`,
    )
  })
})
