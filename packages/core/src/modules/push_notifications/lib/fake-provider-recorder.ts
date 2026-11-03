import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('push_notifications')

/**
 * Test-only sink recording the **provider-native** message each push adapter handed its SDK client.
 *
 * The `channel-{fcm,apns,expo}` fakes replace the SDK *client*, not the adapter — so the real adapter
 * builds the native message, but nothing persists it: no adapter returns `metadata` on success, and
 * APNs deliberately reports an empty `externalMessageId` (its value reaches the admin-exposed
 * `provider_response`, which must never carry token material). The message is therefore written here,
 * out of band.
 *
 * **Why a file and not an in-memory recorder.** The adapter does not run in the spec's process, and
 * *which* process it runs in is not fixed: the send happens in the Next.js app server (which may
 * process the job inline), in a drain child that `drainIntegrationQueue` spawns whenever
 * `OM_TEST_APP_ROOT` is set, or — only in the monorepo path — in the Playwright process itself. A
 * module-level array would live in whichever of those three ran the adapter, and the spec could read it
 * in just one. The queue already crosses exactly these boundaries through `QUEUE_BASE_DIR`, so the sink
 * rides the same directory rather than inventing a second IPC channel.
 *
 * Production safety: every entry point is a no-op unless `OM_PUSH_FAKE_PROVIDERS` is set. Mirrors
 * `ensurePushStubAdapterRegistered()` in ./push-stub-adapter.ts.
 */
export const PUSH_FAKE_PROVIDERS_ENV = 'OM_PUSH_FAKE_PROVIDERS'

const LOG_FILE_NAME = 'push-fake-messages.jsonl'

export type FakePushProvider = 'fcm' | 'apns' | 'expo'

export type FakePushEntry = {
  provider: FakePushProvider
  tokenTail: string
  native: Record<string, unknown>
  at: string
}

export function isPushFakeProvidersEnabled(): boolean {
  return parseBooleanToken(process.env[PUSH_FAKE_PROVIDERS_ENV]) === true
}

const warnedFakeProviders = new Set<FakePushProvider>()

/**
 * Loudly flag — exactly once per provider per process — that a push adapter is running against the
 * network-free fake instead of the real SDK. `OM_PUSH_FAKE_PROVIDERS` is a test-harness flag, and a
 * legitimate-but-misplaced `=1` (e.g. a staging env block promoted to prod) would otherwise report
 * every push as `sent` with no delivery, no log line, and no admin signal for days. This warn plus the
 * `degraded` health status (see `makePushClientConfigHealthCheck`) make that misconfiguration visible.
 */
export function warnPushFakeProvidersActive(provider: FakePushProvider): void {
  if (!isPushFakeProvidersEnabled() || warnedFakeProviders.has(provider)) return
  warnedFakeProviders.add(provider)
  logger.warn(
    `${provider} push adapter is running in FAKE mode (${PUSH_FAKE_PROVIDERS_ENV} is set): messages are recorded, NOT delivered. This must never be set in production.`,
    { provider, env: PUSH_FAKE_PROVIDERS_ENV },
  )
}

/**
 * The one place the queue base dir is resolved. The worker process, the drain child, and the spec must
 * all agree, so every caller goes through this: `QUEUE_BASE_DIR` when set (the harness always sets it,
 * and `drainIntegrationQueue` propagates it to its child), else `<appRoot>/.mercato/queue`.
 *
 * In the app/worker process `cwd` IS the app root. The Playwright process runs from the repo root, so
 * `helpers/integration/pushFake` sets `QUEUE_BASE_DIR` before anything reads it — this fallback is never
 * reached there.
 */
export function resolveQueueBaseDir(): string {
  const explicit = process.env.QUEUE_BASE_DIR?.trim()
  if (explicit) return explicit
  return path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || process.cwd(), '.mercato/queue')
}

export function resolveFakePushLogPath(): string {
  return path.join(resolveQueueBaseDir(), LOG_FILE_NAME)
}

/** Token tail used to key entries — never the raw token (mirrors `token_snapshot` on the delivery row). */
export function pushTokenTail(token: string): string {
  return token.slice(-8)
}

/**
 * An 8-char token tail unique to this run.
 *
 * The sink is append-only and is NOT truncated between runs on the reused-environment path
 * (`tryReuseExistingEnvironment` does not wipe `QUEUE_BASE_DIR`, unlike the fresh path). A compile-time
 * constant tail would therefore let a *previous* run's entry satisfy an assertion before this run's
 * worker had written anything — a false pass. Uniqueness also isolates specs running in parallel.
 */
export function uniquePushTokenTail(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

export function recordFakePush(provider: FakePushProvider, token: string, native: Record<string, unknown>): void {
  if (!isPushFakeProvidersEnabled()) return
  const entry: FakePushEntry = {
    provider,
    tokenTail: pushTokenTail(token),
    native,
    at: new Date().toISOString(),
  }
  const filePath = resolveFakePushLogPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // A single `O_APPEND` write of one short line — concurrent deliveries interleave by line, not within one.
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8')
}

function parseEntry(line: string): FakePushEntry | null {
  try {
    return JSON.parse(line) as FakePushEntry
  } catch {
    // A reader can observe a line the writer has not finished appending. Skipping it lets the caller
    // poll again; throwing would permanently fail the enclosing `expect.poll`.
    return null
  }
}

export function readFakePushLog(): FakePushEntry[] {
  const filePath = resolveFakePushLogPath()
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(parseEntry)
    .filter((entry): entry is FakePushEntry => entry !== null)
}

/**
 * Find the message a spec's own device produced. `tokenTail` should come from
 * {@link uniquePushTokenTail}; `sinceIso` additionally rejects entries predating the caller, so a stale
 * sink can never satisfy an assertion.
 */
export function findFakePush(
  provider: FakePushProvider,
  tokenTail: string,
  sinceIso?: string,
): FakePushEntry | undefined {
  return readFakePushLog()
    .filter((entry) => entry.provider === provider && entry.tokenTail === tokenTail)
    .filter((entry) => !sinceIso || entry.at >= sinceIso)
    .pop()
}

export function clearFakePushLog(): void {
  const filePath = resolveFakePushLogPath()
  if (fs.existsSync(filePath)) fs.rmSync(filePath)
}
