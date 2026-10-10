import fs from 'node:fs'
import path from 'node:path'

import {
  UPGRADE_LOCK_ID,
  UPGRADE_LOCK_NAMESPACE,
  UpgradeLockTimeoutError,
  parseUpgradeLockArgs,
  withUpgradeLock,
  type UpgradeLockClient,
} from '../upgrade-lock'

type RecordedQuery = { sql: string; values?: unknown[] }

function createFakeClient(acquireResults: boolean[]): {
  client: UpgradeLockClient
  queries: RecordedQuery[]
  connects: number
  ends: number
} {
  const queries: RecordedQuery[] = []
  const state = { connects: 0, ends: 0 }
  let attempt = 0

  const client: UpgradeLockClient = {
    connect: async () => {
      state.connects += 1
    },
    query: async (sql, values) => {
      queries.push({ sql, values })
      if (sql.includes('pg_try_advisory_lock')) {
        const acquired = acquireResults[attempt] ?? acquireResults[acquireResults.length - 1] ?? true
        attempt += 1
        return { rows: [{ acquired }] }
      }
      return { rows: [{}] }
    },
    end: async () => {
      state.ends += 1
    },
  }

  return {
    client,
    queries,
    get connects() {
      return state.connects
    },
    get ends() {
      return state.ends
    },
  }
}

describe('parseUpgradeLockArgs', () => {
  it('defaults to locking with no explicit timeout', () => {
    expect(parseUpgradeLockArgs([])).toEqual({ skip: false, timeoutSeconds: undefined })
  })

  it('accepts both spellings of --lock-timeout', () => {
    expect(parseUpgradeLockArgs(['--lock-timeout=30']).timeoutSeconds).toBe(30)
    expect(parseUpgradeLockArgs(['--lock-timeout', '45']).timeoutSeconds).toBe(45)
  })

  it('detects --no-lock', () => {
    expect(parseUpgradeLockArgs(['--no-lock']).skip).toBe(true)
  })

  it('rejects a non-numeric or negative timeout instead of silently defaulting', () => {
    expect(() => parseUpgradeLockArgs(['--lock-timeout=soon'])).toThrow(/Invalid --lock-timeout/)
    expect(() => parseUpgradeLockArgs(['--lock-timeout=-1'])).toThrow(/Invalid --lock-timeout/)
  })
})

describe('withUpgradeLock', () => {
  it('acquires the documented lock, runs the action, then unlocks and closes', async () => {
    const fake = createFakeClient([true])
    const result = await withUpgradeLock(async () => 'done', {
      createClient: async () => fake.client,
    })

    expect(result).toBe('done')
    expect(fake.connects).toBe(1)
    expect(fake.ends).toBe(1)
    expect(fake.queries[0]?.sql).toContain('pg_try_advisory_lock')
    expect(fake.queries[0]?.values).toEqual([UPGRADE_LOCK_NAMESPACE, UPGRADE_LOCK_ID])
    expect(fake.queries[1]?.sql).toContain('pg_advisory_unlock')
    expect(fake.queries[1]?.values).toEqual([UPGRADE_LOCK_NAMESPACE, UPGRADE_LOCK_ID])
  })

  it('hands the action the locked connection so a preflight can reuse it', async () => {
    const fake = createFakeClient([true])
    let received: UpgradeLockClient | null = null
    await withUpgradeLock(
      async (client) => {
        received = client
      },
      { createClient: async () => fake.client },
    )
    expect(received).toBe(fake.client)
  })

  it('retries while another holder has the lock, then proceeds', async () => {
    const fake = createFakeClient([false, false, true])
    const sleeps: number[] = []
    let ran = false

    await withUpgradeLock(
      async () => {
        ran = true
      },
      {
        createClient: async () => fake.client,
        retryIntervalMs: 10,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
    )

    expect(ran).toBe(true)
    expect(sleeps).toEqual([10, 10])
    expect(fake.queries.filter((q) => q.sql.includes('pg_try_advisory_lock'))).toHaveLength(3)
  })

  it('fails loudly on timeout rather than waiting forever, and never runs the action', async () => {
    const fake = createFakeClient([false])
    let elapsed = 0
    let ran = false

    await expect(
      withUpgradeLock(
        async () => {
          ran = true
        },
        {
          createClient: async () => fake.client,
          timeoutSeconds: 1,
          retryIntervalMs: 500,
          sleep: async () => {
            elapsed += 500
          },
          now: () => elapsed,
        },
      ),
    ).rejects.toThrow(UpgradeLockTimeoutError)

    expect(ran).toBe(false)
    expect(fake.ends).toBe(1)
  })

  // Regression: a `--lock-timeout` at or below the retry interval used to fail on the first attempt
  // without ever waiting, because the check asked whether a full interval would overshoot.
  it('still retries when the timeout is no longer than the retry interval', async () => {
    const fake = createFakeClient([false, true])
    let elapsed = 0
    const sleeps: number[] = []

    await withUpgradeLock(async () => undefined, {
      createClient: async () => fake.client,
      timeoutSeconds: 5,
      retryIntervalMs: 5000,
      sleep: async (ms) => {
        sleeps.push(ms)
        elapsed += ms
      },
      now: () => elapsed,
    })

    expect(sleeps).toEqual([5000])
    expect(fake.queries.filter((q) => q.sql.includes('pg_try_advisory_lock'))).toHaveLength(2)
  })

  it('never waits past the deadline the operator asked for', async () => {
    const fake = createFakeClient([false])
    let elapsed = 0
    const sleeps: number[] = []

    await expect(
      withUpgradeLock(async () => undefined, {
        createClient: async () => fake.client,
        timeoutSeconds: 7,
        retryIntervalMs: 5000,
        sleep: async (ms) => {
          sleeps.push(ms)
          elapsed += ms
        },
        now: () => elapsed,
      }),
    ).rejects.toThrow(UpgradeLockTimeoutError)

    expect(sleeps).toEqual([5000, 2000])
    expect(sleeps.reduce((total, ms) => total + ms, 0)).toBe(7000)
  })

  it('names the lock in the timeout message so an operator can find the holder', async () => {
    const fake = createFakeClient([false])
    await expect(
      withUpgradeLock(async () => undefined, {
        createClient: async () => fake.client,
        timeoutSeconds: 0,
        retryIntervalMs: 1,
      }),
    ).rejects.toThrow(new RegExp(`pg_try_advisory_lock\\(${UPGRADE_LOCK_NAMESPACE}, ${UPGRADE_LOCK_ID}\\)`))
  })

  it('releases the lock and closes the connection when the action throws', async () => {
    const fake = createFakeClient([true])

    await expect(
      withUpgradeLock(
        async () => {
          throw new Error('migration blew up')
        },
        { createClient: async () => fake.client },
      ),
    ).rejects.toThrow('migration blew up')

    expect(fake.queries.some((q) => q.sql.includes('pg_advisory_unlock'))).toBe(true)
    expect(fake.ends).toBe(1)
  })

  it('does not replace the action error when the unlock itself fails', async () => {
    const fake = createFakeClient([true])
    const client: UpgradeLockClient = {
      ...fake.client,
      query: async (sql, values) => {
        if (sql.includes('pg_advisory_unlock')) throw new Error('connection already gone')
        return fake.client.query(sql, values)
      },
    }

    await expect(
      withUpgradeLock(
        async () => {
          throw new Error('migration blew up')
        },
        { createClient: async () => client },
      ),
    ).rejects.toThrow('migration blew up')
  })

  it('--no-lock runs the action with no connection and no lock statement', async () => {
    const fake = createFakeClient([true])
    let skipped = false
    let received: UpgradeLockClient | null = fake.client

    await withUpgradeLock(
      async (client) => {
        received = client
      },
      {
        skip: true,
        createClient: async () => fake.client,
        onSkip: () => {
          skipped = true
        },
      },
    )

    expect(skipped).toBe(true)
    expect(received).toBeNull()
    expect(fake.connects).toBe(0)
    expect(fake.queries).toHaveLength(0)
  })

  // A session advisory lock belongs to the connection that took it, so taking it on the ORM pool
  // would let a recycled connection drop it silently while the caller still believes it is held.
  // The guarantee is structural, which is why it is asserted against the source rather than mocked.
  it('holds the lock on a dedicated pg client, never the ORM pool', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'upgrade-lock.ts'), 'utf8')
    expect(source).toContain("await import('pg')")
    expect(source).toContain('new Client({')
    expect(source).not.toMatch(/MikroORM|mikro-orm|EntityManager|createRequestContainer/)
  })
})
