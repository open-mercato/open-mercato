import * as filesystem from 'node:fs/promises'
import { constants } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireBackupLock } from '../lib/engine/lock'

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { __esModule: true, ...actual, lstat: jest.fn(actual.lstat), unlink: jest.fn(actual.unlink), open: jest.fn(actual.open) }
})

function deferred() {
  let complete: () => void = () => {}
  const promise = new Promise<void>((resolve) => { complete = resolve })
  return { promise, complete }
}

describe('backup file lock ownership', () => {
  let directory: string

  beforeEach(async () => {
    const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
    jest.mocked(filesystem.lstat).mockImplementation(actual.lstat)
    jest.mocked(filesystem.unlink).mockImplementation(actual.unlink)
    jest.mocked(filesystem.open).mockImplementation(actual.open)
    directory = await filesystem.mkdtemp(join(tmpdir(), 'om-backup-lock-'))
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await filesystem.rm(directory, { recursive: true, force: true })
  })

  test('concurrent stale resumes cannot both own the replacement lock', async () => {
    const lockPath = join(directory, 'lock')
    const staleAt = new Date(Date.now() - 120_000).toISOString()
    const oldRunId = randomUUID()
    await filesystem.writeFile(lockPath, JSON.stringify({
      runId: oldRunId, host: hostname(), pid: 2147483647, startedAt: staleAt, heartbeatAt: staleAt,
    }))
    const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
    const originalStat = actual.lstat
    const originalUnlink = actual.unlink
    const originalOpen = actual.open
    const validatedOldInode = deferred()
    const firstReplacementCreated = deferred()
    let statCount = 0
    let unlinkCount = 0
    let replacementCreated = false

    jest.spyOn(filesystem, 'lstat').mockImplementation((async (...args: Parameters<typeof filesystem.lstat>) => {
      const result = await originalStat(...args)
      if (args[0] === lockPath && ++statCount === 4) validatedOldInode.complete()
      return result
    }) as typeof filesystem.lstat)
    jest.spyOn(filesystem, 'unlink').mockImplementation(async (path) => {
      if (path === lockPath) {
        const attempt = ++unlinkCount
        if (attempt <= 2) {
          await validatedOldInode.promise
          if (attempt === 2 && !replacementCreated) await firstReplacementCreated.promise
        }
      }
      return originalUnlink(path)
    })
    jest.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      if (args[0] === lockPath && typeof args[1] === 'number' && (args[1] & constants.O_CREAT) && !replacementCreated) {
        replacementCreated = true
        firstReplacementCreated.complete()
      }
      return handle
    })

    const first = acquireBackupLock(lockPath, randomUUID())
    const second = acquireBackupLock(lockPath, randomUUID())
    void second.then(validatedOldInode.complete, validatedOldInode.complete)
    const results = await Promise.allSettled([first, second])
    const owners = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    try {
      expect(owners).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    } finally {
      for (const release of owners) await release()
    }
  })

  test('a crashed acquisition guard remains closed until an operator releases it', async () => {
    const lockPath = join(directory, 'lock')
    const guardPath = `${lockPath}.guard`
    const abandonedOwner = JSON.stringify({ runId: randomUUID(), host: hostname(), pid: 2147483647 })
    await filesystem.writeFile(guardPath, abandonedOwner)
    await expect(acquireBackupLock(lockPath, randomUUID())).rejects.toThrow('LIVE_LOCK')
    expect(await filesystem.readFile(guardPath, 'utf8')).toBe(abandonedOwner)
    expect(await filesystem.readdir(directory)).toEqual(['lock.guard'])
  })

  test('releasing an old owner preserves a replacement inode and its metadata', async () => {
    const lockPath = join(directory, 'lock')
    const release = await acquireBackupLock(lockPath, randomUUID())
    await filesystem.rename(lockPath, join(directory, 'retired-lock'))
    const replacement = JSON.stringify({ runId: randomUUID(), host: hostname(), pid: process.pid })
    await filesystem.writeFile(lockPath, replacement)
    await release()
    expect(await filesystem.readFile(lockPath, 'utf8')).toBe(replacement)
    expect(await filesystem.readdir(directory)).not.toContain('lock.guard')
  })

  test('normal acquisition and refusal leave no guard after either owner exits', async () => {
    const lockPath = join(directory, 'lock')
    const release = await acquireBackupLock(lockPath, randomUUID())
    try {
      await expect(acquireBackupLock(lockPath, randomUUID())).rejects.toThrow('LIVE_LOCK')
      expect(await filesystem.readdir(directory)).toEqual(['lock'])
    } finally { await release() }
    expect(await filesystem.readdir(directory)).toEqual([])
  })


  test('publication can rename the partial directory before releasing its owned handle', async () => {
    const partial = join(directory, 'partial')
    const published = join(directory, 'published')
    await filesystem.mkdir(partial)
    const release = await acquireBackupLock(join(partial, 'lock'), randomUUID())
    await filesystem.rename(partial, published)
    await expect(release()).resolves.toBeUndefined()
    expect(await filesystem.readdir(published)).toEqual(['lock'])
  })

})
