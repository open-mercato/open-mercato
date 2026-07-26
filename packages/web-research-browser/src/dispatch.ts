import { assertPublicUrl } from '@open-mercato/web-research'
import {
  DEFAULT_USER_AGENT,
  LAUNCH_ARGS,
  importChromium,
  installNavigationGuard,
  launchChromium,
  type InstallRunner,
  type BrowserHandle,
  type ContextHandle,
  type PageHandle,
} from './playwright'
import { SidecarError, type SidecarReply, type SidecarRequest } from './protocol'

export type Lease = { context: ContextHandle; page: PageHandle }

export type SidecarState = {
  browser: BrowserHandle | null
  leases: Map<string, Lease>
  filterSubresources: boolean
  warn: (message: string) => void
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
    ...overrides,
  }
}

async function ensureBrowser(state: SidecarState): Promise<BrowserHandle> {
  if (state.browser) return state.browser
  const chromium = await importChromium()
  state.browser = await launchChromium(
    chromium,
    { headless: true, args: LAUNCH_ARGS },
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
  const existing = state.leases.get(leaseId)
  if (existing) return existing
  const browser = await ensureBrowser(state)
  const context = await browser.newContext({ userAgent, locale: 'en-US' })
  await installNavigationGuard(context, { filterSubresources: state.filterSubresources, warn: state.warn })
  const page = (await context.newPage()) as unknown as PageHandle
  const lease: Lease = { context, page }
  state.leases.set(leaseId, lease)
  return lease
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
