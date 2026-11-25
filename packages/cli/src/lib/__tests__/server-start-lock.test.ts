import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  acquireServerStartLock,
  getServerStartLockPath,
  readProcessStartTime,
} from '../server-start-lock'

const BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id'
const CURRENT_BOOT_ID = '6f1c2a7e-0b3d-4c58-9a51-2f7e8d4b1c90'
const hasProcFs = fs.existsSync(`/proc/${process.pid}/stat`)

function buildStatLine(pid: number, startTime: string, command = 'node'): string {
  const fieldsBeforeStartTime = ['S', ...Array.from({ length: 18 }, () => '0')]
  return `${pid} (${command}) ${[...fieldsBeforeStartTime, startTime, '1024', '256'].join(' ')}\n`
}

function mockProcFs(entries: Record<string, string>) {
  const realReadFileSync = fs.readFileSync
  return jest.spyOn(fs, 'readFileSync').mockImplementation(((
    file: fs.PathOrFileDescriptor,
    options?: Parameters<typeof fs.readFileSync>[1],
  ) => {
    if (typeof file === 'string' && file.startsWith('/proc/')) {
      const content = entries[file]
      if (content === undefined) {
        const missing = new Error(`ENOENT: no such file or directory, open '${file}'`) as NodeJS.ErrnoException
        missing.code = 'ENOENT'
        throw missing
      }
      return content
    }
    return realReadFileSync(file, options)
  }) as typeof fs.readFileSync)
}

function writeLock(lockPath: string, record: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  fs.writeFileSync(lockPath, JSON.stringify(record))
}

describe('server start lock', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-server-lock-'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
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

  it('takes over a lock whose pid now belongs to an unrelated process', () => {
    mockProcFs({
      [BOOT_ID_PATH]: `${CURRENT_BOOT_ID}\n`,
      [`/proc/${process.pid}/stat`]: buildStatLine(process.pid, '90210'),
      [`/proc/${process.ppid}/stat`]: buildStatLine(process.ppid, '4321', 'sh'),
    })
    const lockPath = getServerStartLockPath(tempDir)
    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
      processStartTime: '1234',
      bootId: CURRENT_BOOT_ID,
    })

    const handle = acquireServerStartLock(tempDir, { port: '3000' })

    const written = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(written).toMatchObject({
      pid: process.pid,
      port: '3000',
      processStartTime: '90210',
      bootId: CURRENT_BOOT_ID,
    })

    handle.release()
  })

  it('refuses a lock whose owner is still the same running process', () => {
    mockProcFs({
      [BOOT_ID_PATH]: `${CURRENT_BOOT_ID}\n`,
      [`/proc/${process.pid}/stat`]: buildStatLine(process.pid, '90210'),
      [`/proc/${process.ppid}/stat`]: buildStatLine(process.ppid, '1234'),
    })
    const lockPath = getServerStartLockPath(tempDir)
    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
      processStartTime: '1234',
      bootId: CURRENT_BOOT_ID,
    })

    expect(() => acquireServerStartLock(tempDir, { port: '3000' })).toThrow(
      `Another Open Mercato production server is already running for ${tempDir} (pid ${process.ppid} on port 3000)`,
    )
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(process.ppid)
  })

  it('takes over a lock written before a reboot', () => {
    mockProcFs({
      [BOOT_ID_PATH]: `${CURRENT_BOOT_ID}\n`,
      [`/proc/${process.pid}/stat`]: buildStatLine(process.pid, '90210'),
      [`/proc/${process.ppid}/stat`]: buildStatLine(process.ppid, '1234'),
    })
    const lockPath = getServerStartLockPath(tempDir)
    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
      processStartTime: '1234',
      bootId: 'a-previous-boot',
    })

    const handle = acquireServerStartLock(tempDir, { port: '3000' })

    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
    handle.release()
  })

  it('keeps refusing a live pid from a lock written by an older version', () => {
    mockProcFs({
      [BOOT_ID_PATH]: `${CURRENT_BOOT_ID}\n`,
      [`/proc/${process.pid}/stat`]: buildStatLine(process.pid, '90210'),
      [`/proc/${process.ppid}/stat`]: buildStatLine(process.ppid, '4321'),
    })
    const lockPath = getServerStartLockPath(tempDir)
    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
    })

    expect(() => acquireServerStartLock(tempDir, { port: '3000' })).toThrow(
      `Another Open Mercato production server is already running for ${tempDir}`,
    )
  })

  it('falls back to the pid check where /proc is unavailable', () => {
    mockProcFs({})
    const lockPath = getServerStartLockPath(tempDir)
    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
      processStartTime: '1234',
      bootId: CURRENT_BOOT_ID,
    })

    expect(() => acquireServerStartLock(tempDir, { port: '3000' })).toThrow(
      `Another Open Mercato production server is already running for ${tempDir}`,
    )

    fs.rmSync(lockPath)
    const handle = acquireServerStartLock(tempDir, { port: '3000' })
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toMatchObject({
      pid: process.pid,
      processStartTime: null,
      bootId: null,
    })
    handle.release()
  })

  it('reads the start time when the command name contains spaces and parentheses', () => {
    mockProcFs({
      '/proc/4242/stat': buildStatLine(4242, '777001', 'node (server) 9 S'),
      '/proc/4243/stat': '4243 (broken',
    })

    expect(readProcessStartTime(4242)).toBe('777001')
    expect(readProcessStartTime(4243)).toBeNull()
    expect(readProcessStartTime(4244)).toBeNull()
  })

  ;(hasProcFs ? it : it.skip)('identifies the real lock owner through /proc', () => {
    const parentStartTime = readProcessStartTime(process.ppid)
    expect(parentStartTime).toMatch(/^\d+$/)
    const lockPath = getServerStartLockPath(tempDir)
    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
      processStartTime: parentStartTime,
    })

    expect(() => acquireServerStartLock(tempDir, { port: '3000' })).toThrow(
      `Another Open Mercato production server is already running for ${tempDir}`,
    )

    writeLock(lockPath, {
      pid: process.ppid,
      port: '3000',
      startedAt: new Date().toISOString(),
      processStartTime: `${parentStartTime}1`,
    })
    const handle = acquireServerStartLock(tempDir, { port: '3000' })
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).processStartTime).toBe(readProcessStartTime(process.pid))
    handle.release()
  })
})
