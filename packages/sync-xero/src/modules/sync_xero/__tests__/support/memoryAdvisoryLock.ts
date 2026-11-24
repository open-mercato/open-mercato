import { AdvisoryLockUnavailableError, type AdvisoryLockUnavailableReason } from '@open-mercato/shared/lib/db/advisoryLock'

type LockWork = (lockEm: unknown) => Promise<unknown>

/**
 * An in-process stand-in for `withAdvisoryXactLock`: holders of one key run one at a time in
 * arrival order, so a test can hold the lock open and observe who waits on it.
 */
export function createMemoryAdvisoryLock() {
  const tails = new Map<string, Promise<void>>()
  const held = new Set<string>()
  const keys: string[] = []
  const failures: AdvisoryLockUnavailableReason[] = []

  async function run(em: unknown, key: string, work: LockWork): Promise<unknown> {
    keys.push(key)
    const failure = failures.shift()
    if (failure === 'deadline' || failure === 'transient_db') throw new AdvisoryLockUnavailableError(failure, key)
    const previous = tails.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    tails.set(key, previous.then(() => current))
    await previous
    held.add(key)
    try {
      const value = await work(em)
      if (failure === 'commit_unknown') throw new AdvisoryLockUnavailableError(failure, key)
      return value
    } finally {
      held.delete(key)
      release()
    }
  }

  return {
    run,
    keys,
    isHeld: (key: string) => held.has(key),
    failNext: (reason: AdvisoryLockUnavailableReason) => {
      failures.push(reason)
    },
    reset: () => {
      tails.clear()
      held.clear()
      keys.length = 0
      failures.length = 0
    },
  }
}

export const memoryAdvisoryLock = createMemoryAdvisoryLock()
