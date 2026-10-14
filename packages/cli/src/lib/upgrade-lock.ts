import { getSslConfig } from '@open-mercato/shared/lib/db/ssl'

// `pg_advisory_lock` takes either one bigint or two int4s. The two-int4 form is used so the
// namespace is readable in `pg_locks.classid`/`objid` during an incident: 0x4F4D is 'OM' and
// 0x5547 is 'UG'.
export const UPGRADE_LOCK_NAMESPACE = 0x4f4d
export const UPGRADE_LOCK_ID = 0x5547

const DEFAULT_LOCK_TIMEOUT_SECONDS = 600
const DEFAULT_RETRY_INTERVAL_MS = 5000

/**
 * The subset of `pg.Client` this module uses. Declared structurally so a test can supply a
 * double without a database, and so nothing here can reach for a pooled connection by accident.
 */
export type UpgradeLockClient = {
  connect: () => Promise<void>
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  end: () => Promise<void>
}

export type UpgradeLockOptions = {
  /** Seconds to keep retrying acquisition before giving up. */
  timeoutSeconds?: number
  /** Interval between acquisition attempts. */
  retryIntervalMs?: number
  /** Skip locking entirely (`--no-lock`). Local use only. */
  skip?: boolean
  /**
   * Supplies the dedicated connection. Overridden in tests only — production always opens its
   * own `pg.Client`, never the ORM pool (see the class doc below).
   */
  createClient?: () => Promise<UpgradeLockClient>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onWait?: (attempt: number, elapsedSeconds: number) => void
  onSkip?: () => void
}

export class UpgradeLockTimeoutError extends Error {
  constructor(public readonly timeoutSeconds: number) {
    super(
      `Could not acquire the Open Mercato upgrade lock within ${timeoutSeconds}s. ` +
        `Another migrate or upgrade run is holding pg_try_advisory_lock(${UPGRADE_LOCK_NAMESPACE}, ${UPGRADE_LOCK_ID}).`,
    )
    this.name = 'UpgradeLockTimeoutError'
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createDedicatedClient(): Promise<UpgradeLockClient> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('[internal] DATABASE_URL is not set')

  const { Client } = await import('pg')
  return new Client({ connectionString: url, ssl: getSslConfig() }) as unknown as UpgradeLockClient
}

/**
 * Parses the lock flags shared by `mercato upgrade` and `mercato db migrate`.
 *
 * Accepts both `--lock-timeout=<seconds>` and `--lock-timeout <seconds>`; a scoped run silently
 * widening into an unscoped one because only one spelling parsed is a defect this repo already
 * carries elsewhere (`auth sync-role-acls`), and it is not worth repeating here.
 */
export function parseUpgradeLockArgs(args: readonly string[]): {
  skip: boolean
  timeoutSeconds?: number
} {
  const skip = args.includes('--no-lock')
  let timeoutSeconds: number | undefined

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) continue

    let raw: string | undefined
    if (token.startsWith('--lock-timeout=')) {
      raw = token.slice('--lock-timeout='.length)
    } else if (token === '--lock-timeout') {
      raw = args[index + 1]
    }
    if (raw === undefined) continue

    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --lock-timeout value: ${raw}`)
    }
    timeoutSeconds = parsed
  }

  return { skip, timeoutSeconds }
}

/**
 * Runs `action` while holding one Postgres session advisory lock, so every shipped migration
 * entrypoint serializes against every other one.
 *
 * Three properties are load-bearing and each has a failure mode behind it:
 *
 * - **A dedicated connection, never the ORM pool.** A session advisory lock belongs to the
 *   session that took it. The pool recycles connections, so a lock taken on a pooled connection
 *   can be silently dropped mid-run while the caller still believes it is held. The connection
 *   also stays separate from the one running DDL, which keeps patterns like
 *   `CREATE INDEX CONCURRENTLY` available to migrations.
 * - **`pg_try_advisory_lock` with bounded retry, not `pg_advisory_lock`.** The blocking form waits
 *   forever, turning a deploy race into a hung Job that looks exactly like a slow migration. The
 *   try form with a deadline fails loudly instead, and a deploy Job's own retry is then the
 *   recovery path.
 * - **Release on every path, including a throw.** The lock would die with the connection anyway —
 *   that is why this is a session lock rather than a lock table, and why there is no `unlock`
 *   command to document — but releasing explicitly keeps a long-lived process honest.
 *
 * The connection must use a direct database URL. A transaction-mode pooler (PgBouncer and friends)
 * hands successive statements different backend sessions, which drops the lock without any error.
 */
export async function withUpgradeLock<T>(
  action: (client: UpgradeLockClient | null) => Promise<T>,
  options: UpgradeLockOptions = {},
): Promise<T> {
  if (options.skip) {
    options.onSkip?.()
    return action(null)
  }

  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_LOCK_TIMEOUT_SECONDS
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

  const client = await (options.createClient ?? createDedicatedClient)()
  await client.connect()

  try {
    const startedAt = now()
    let attempt = 0
    let acquired = false

    for (;;) {
      attempt += 1
      const result = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
        UPGRADE_LOCK_NAMESPACE,
        UPGRADE_LOCK_ID,
      ])
      acquired = result.rows?.[0]?.acquired === true
      if (acquired) break

      const elapsedMs = now() - startedAt
      const remainingMs = timeoutSeconds * 1000 - elapsedMs
      if (remainingMs <= 0) throw new UpgradeLockTimeoutError(timeoutSeconds)

      // Clamped to what is left of the budget, so a timeout shorter than the retry interval still
      // gets its one retry instead of failing on the first attempt — and so no wait overshoots the
      // deadline the operator asked for.
      options.onWait?.(attempt, elapsedMs / 1000)
      await sleep(Math.min(retryIntervalMs, remainingMs))
    }

    try {
      return await action(client)
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [
          UPGRADE_LOCK_NAMESPACE,
          UPGRADE_LOCK_ID,
        ])
      } catch {
        // The lock dies with the connection closed below, so a failed unlock is not worth
        // replacing the caller's own error with.
      }
    }
  } finally {
    try {
      await client.end()
    } catch {}
  }
}
