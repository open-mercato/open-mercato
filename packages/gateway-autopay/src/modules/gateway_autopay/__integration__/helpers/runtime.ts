import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from '@playwright/test'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { drainQueueFromAppRoot } from '@open-mercato/core/helpers/integration/queue-runner'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { AUTOPAY_STATUS_POLLER_QUEUE } from '../../lib/status-poller-schedule'

const AUTOPAY_STATUS_ENDPOINT = 'https://testpay.autopay.eu/webapi/transactionStatus'
const DRAIN_JOB_LIMIT = 100

/**
 * Set by the CI lane that exists to run the in-process poller specs. Under it a
 * spec that would otherwise skip fails instead, so a misconfigured lane cannot
 * pass by silently skipping the production worker.
 */
export const IN_PROCESS_WORKERS_REQUIRED_ENV = 'OM_INTEGRATION_IN_PROCESS_WORKERS_REQUIRED'

/**
 * The Autopay client only talks to the two documented hosts, so the provider
 * cannot be pointed at a stub server. The specs therefore replace the global
 * `fetch` of the process that runs the poller worker. That is only this
 * Playwright process when queue jobs are drained in-process: with managed
 * workers (`AUTO_SPAWN_WORKERS=true`, the local default) the app's own worker
 * would poll the real sandbox host with fixture credentials, and a standalone
 * app (`OM_TEST_APP_ROOT`) drains in a child process the stub cannot reach.
 */
export function resolveInProcessPollerSkipReason(): string | null {
  const managedWorkers =
    parseBooleanToken(process.env.AUTO_SPAWN_WORKERS)
    ?? parseBooleanToken(process.env.OM_AUTO_SPAWN_WORKERS)
    ?? true
  if (managedWorkers) {
    return 'Autopay HTTP is stubbed inside the Playwright process, so the poller worker must be drained in-process: run with AUTO_SPAWN_WORKERS=false'
  }
  if (process.env.OM_TEST_APP_ROOT?.trim()) {
    return 'A standalone app drains queue jobs in a child process where the in-process Autopay HTTP stub is not visible'
  }
  if ((process.env.QUEUE_STRATEGY || 'local') === 'async') {
    return 'The in-process scheduler tick uses the local scheduler strategy; the BullMQ strategy dispatches from its own worker'
  }
  return null
}

/**
 * Skips the current test outside the in-process worker lane. When the lane is
 * declared required (`OM_INTEGRATION_IN_PROCESS_WORKERS_REQUIRED`), the same
 * condition is a failure: that lane's whole purpose is to run these specs.
 */
export function requireInProcessPollerLane(): void {
  const skipReason = resolveInProcessPollerSkipReason()
  if (!skipReason) return
  if (parseBooleanWithDefault(process.env[IN_PROCESS_WORKERS_REQUIRED_ENV], false)) {
    throw new Error(
      `[internal] ${IN_PROCESS_WORKERS_REQUIRED_ENV} is set, but the Autopay poller specs would be skipped: ${skipReason}`,
    )
  }
  test.skip(true, skipReason)
}

function resolveQueueBaseDir(appRoot: string): string {
  return process.env.QUEUE_BASE_DIR?.trim() || path.resolve(appRoot, '.mercato/queue')
}

type AppRuntime = { appRoot: string; queueBaseDir: string }

let runtimePromise: Promise<AppRuntime> | null = null

/**
 * Loads the app's generated registries into this process once, so the real
 * scheduler service and the module workers resolve from the same DI container
 * the app uses. The queue base dir is pinned before any queue is created: the
 * local file queue defaults to a cwd-relative folder, and the Playwright
 * process does not run from the app root.
 */
async function getAppRuntime(): Promise<AppRuntime> {
  if (runtimePromise) return runtimePromise
  runtimePromise = (async () => {
    const appRoot = resolveAppRoot()
    const queueBaseDir = resolveQueueBaseDir(appRoot)
    if (!process.env.QUEUE_BASE_DIR?.trim()) process.env.QUEUE_BASE_DIR = queueBaseDir
    await bootstrapFromAppRoot(appRoot)
    return { appRoot, queueBaseDir }
  })()
  return runtimePromise
}

type LocalSchedulerServiceLike = {
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * Runs one poll of the real local scheduler: it loads every due schedule from
 * the database, re-checks the dispatch guards and enqueues the sanitized
 * payload onto each target queue. `start()` resolves after the first poll, so
 * the service is stopped right away and never ticks again.
 */
export async function runLocalSchedulerTick(): Promise<void> {
  await getAppRuntime()
  const container = await createRequestContainer()
  const scheduler = container.resolve('localSchedulerService') as LocalSchedulerServiceLike
  await scheduler.start()
  await scheduler.stop()
}

export type QueuedPollerJob = {
  id?: string
  payload?: {
    limit?: unknown
    scope?: { tenantId?: unknown; organizationId?: unknown }
    tenantId?: unknown
    organizationId?: unknown
    _jobOrigin?: unknown
    _idempotencyKey?: unknown
  }
}

/** Reads the jobs waiting on the module-owned poller queue, as the scheduler left them. */
export async function readQueuedAutopayPollerJobs(): Promise<QueuedPollerJob[]> {
  const { queueBaseDir } = await getAppRuntime()
  const queueFile = path.join(queueBaseDir, AUTOPAY_STATUS_POLLER_QUEUE, 'queue.json')
  try {
    const parsed = JSON.parse(await readFile(queueFile, 'utf8')) as unknown
    return Array.isArray(parsed) ? (parsed as QueuedPollerJob[]) : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Runs the Autopay poller worker in this process against every queued job. */
export async function drainAutopayPollerQueue(): Promise<number> {
  const { appRoot, queueBaseDir } = await getAppRuntime()
  return drainQueueFromAppRoot(AUTOPAY_STATUS_POLLER_QUEUE, { appRoot, jobLimit: DRAIN_JOB_LIMIT, queueBaseDir })
}

/** Delivers the persistent `directory.organization.created` subscriber that registers the schedule. */
export async function drainEventsQueue(): Promise<number> {
  return drainIntegrationQueue('events')
}

export type AutopayStatusRequest = {
  serviceId: string
  orderId: string
  hash: string
}

export type AutopayStatusResponder = (request: AutopayStatusRequest) => { status: number; body: string }

export type AutopayStatusStubResult<T> = {
  result: T
  requests: AutopayStatusRequest[]
}

/**
 * Answers `transactionStatus` calls made by the poller worker while `run`
 * executes, records every request and leaves all other URLs to the real
 * `fetch`. The original `fetch` is restored even when `run` throws.
 */
export async function withAutopayStatusStub<T>(
  responder: AutopayStatusResponder,
  run: () => Promise<T>,
): Promise<AutopayStatusStubResult<T>> {
  const originalFetch = globalThis.fetch
  const requests: AutopayStatusRequest[] = []
  const stubbedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(AUTOPAY_STATUS_ENDPOINT)) {
      return originalFetch(input, init)
    }
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    const request = {
      serviceId: form.get('ServiceID') ?? '',
      orderId: form.get('OrderID') ?? '',
      hash: form.get('Hash') ?? '',
    }
    requests.push(request)
    const response = responder(request)
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
    })
  }
  globalThis.fetch = stubbedFetch
  try {
    const result = await run()
    return { result, requests }
  } finally {
    globalThis.fetch = originalFetch
  }
}
