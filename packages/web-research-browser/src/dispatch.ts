import { assertPublicUrl } from '@open-mercato/web-research'
import {
  DEFAULT_USER_AGENT,
  isSandboxDisabled,
  resolveLaunchArgs,
  importChromium,
  installNavigationGuard,
  launchChromium,
  type InstallRunner,
  type BrowserHandle,
  type ContextHandle,
  type PageHandle,
} from './playwright'
import { SidecarError, type SidecarReply, type SidecarRequest } from './protocol'

export type Lease = { context: ContextHandle; page: PageHandle; touchedAt: number }

/**
 * How long an untouched lease may live.
 *
 * `release` normally closes a context, but the caller can die between `render`
 * and `release` — a killed parent, a dropped socket — and every orphan is a live
 * BrowserContext holding memory for as long as the sidecar runs.
 */
export const LEASE_IDLE_TIMEOUT_MS = 5 * 60_000

export type SidecarState = {
  browser: BrowserHandle | null
  leases: Map<string, Lease>
  filterSubresources: boolean
  warn: (message: string) => void
  /** Injectable so a lease-expiry test does not have to wait five minutes. */
  now: () => number
  /** Injectable so tests never shell out to `npx playwright install`. */
  installRunner?: InstallRunner
}

export const DEFAULT_GOTO_TIMEOUT_MS = 30_000
const MAX_GOTO_TIMEOUT_MS = 120_000

export function createState(overrides: Partial<SidecarState> = {}): SidecarState {
  return {
    browser: null,
    leases: new Map(),
    filterSubresources: process.env.OM_WEB_RESEARCH_BROWSER_FILTER_SUBRESOURCES === '1',
    warn: (message) => process.stderr.write(`om-web-research-sidecar: ${message}\n`),
    now: () => Date.now(),
    ...overrides,
  }
}

async function ensureBrowser(state: SidecarState): Promise<BrowserHandle> {
  if (state.browser) return state.browser
  const chromium = await importChromium()
  if (isSandboxDisabled()) {
    // Said once per browser, not once per render, but said: this process renders
    // pages chosen by a search engine or a model with the one mitigation
    // Chromium offers against a hostile renderer turned off.
    state.warn(
      'SECURITY: Chromium sandbox is disabled by OM_WEB_RESEARCH_BROWSER_NO_SANDBOX=1 — a renderer compromise reaches this host',
    )
  }
  state.browser = await launchChromium(
    chromium,
    { headless: true, args: resolveLaunchArgs() },
    { onProgress: state.warn, ...(state.installRunner ? { install: state.installRunner } : {}) },
  )
  return state.browser
}

/**
 * One BrowserContext per lease. Contexts are Playwright's real isolation boundary
 * (cookies, storage, cache) and cost ~10ms, so two concurrent searches never share
 * a cookie jar the way a single shared page would.
 */
async function openLease(state: SidecarState, leaseId: string, userAgent: string): Promise<Lease> {
  await reapIdleLeases(state)
  const existing = state.leases.get(leaseId)
  if (existing) {
    existing.touchedAt = state.now()
    return existing
  }
  const browser = await ensureBrowser(state)
  const context = await browser.newContext({ userAgent, locale: 'en-US' })
  await installNavigationGuard(context, { filterSubresources: state.filterSubresources, warn: state.warn })
  const page = (await context.newPage()) as unknown as PageHandle
  const lease: Lease = { context, page, touchedAt: state.now() }
  state.leases.set(leaseId, lease)
  return lease
}

/** Closes leases nobody released. Swept on open, so an idle sidecar stays idle. */
export async function reapIdleLeases(state: SidecarState): Promise<void> {
  const cutoff = state.now() - LEASE_IDLE_TIMEOUT_MS
  for (const [leaseId, lease] of [...state.leases]) {
    if (lease.touchedAt > cutoff) continue
    state.warn(`reaping lease ${leaseId} idle for over ${LEASE_IDLE_TIMEOUT_MS}ms`)
    await closeLease(state, leaseId)
  }
}

async function closeLease(state: SidecarState, leaseId: string): Promise<void> {
  const lease = state.leases.get(leaseId)
  if (!lease) return
  state.leases.delete(leaseId)
  try {
    await lease.context.close()
  } catch {
    // A context that already died takes nothing with it.
  }
}

export async function teardown(state: SidecarState): Promise<void> {
  for (const leaseId of [...state.leases.keys()]) await closeLease(state, leaseId)
  const browser = state.browser
  state.browser = null
  if (browser) {
    try {
      await browser.close()
    } catch {
      // Best effort; the parent escalates to SIGKILL if we hang.
    }
  }
}

function stringParam(request: SidecarRequest, key: string): string {
  const value = request.params?.[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new SidecarError(`missing "${key}" parameter`, 'runtime')
  }
  return value
}

async function dispatchInner(state: SidecarState, request: SidecarRequest): Promise<SidecarReply> {
  switch (request.method) {
    case 'ping':
      return { id: request.id, ok: true, result: { ready: true } }

    case 'render': {
      const url = stringParam(request, 'url')
      const leaseId = stringParam(request, 'leaseId')
      // Re-checked here, in a distinct process from the caller, and BEFORE
      // Playwright is imported — a blocked URL never launches a browser.
      try {
        await assertPublicUrl(url, 'browser render', { failClosed: true })
      } catch (error) {
        return {
          id: request.id,
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error), kind: 'navigation' },
        }
      }

      const userAgent = typeof request.params?.userAgent === 'string' ? request.params.userAgent : DEFAULT_USER_AGENT
      const timeout = Math.min(
        typeof request.params?.timeoutMs === 'number' ? request.params.timeoutMs : DEFAULT_GOTO_TIMEOUT_MS,
        MAX_GOTO_TIMEOUT_MS,
      )
      const waitUntil = typeof request.params?.waitUntil === 'string' ? request.params.waitUntil : 'domcontentloaded'

      const lease = await openLease(state, leaseId, userAgent)
      try {
        await lease.page.goto(url, { waitUntil, timeout })
      } catch (error) {
        return {
          id: request.id,
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error), kind: 'navigation' },
        }
      }
      const html = await lease.page.content()
      return { id: request.id, ok: true, result: { url: lease.page.url(), html } }
    }

    case 'release':
      await closeLease(state, stringParam(request, 'leaseId'))
      return { id: request.id, ok: true }

    case 'close':
      await teardown(state)
      return { id: request.id, ok: true }

    default:
      return {
        id: request.id,
        ok: false,
        error: { message: `unknown method: ${request.method}`, kind: 'runtime' },
      }
  }
}

export async function dispatch(state: SidecarState, request: SidecarRequest): Promise<SidecarReply> {
  try {
    return await dispatchInner(state, request)
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        kind: error instanceof SidecarError ? error.kind : 'unknown',
      },
    }
  }
}
