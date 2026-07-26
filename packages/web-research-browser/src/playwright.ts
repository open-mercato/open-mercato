import { assertPublicUrl } from '@open-mercato/web-research'
import { SidecarError } from './protocol'

/**
 * Structural projections of the Playwright surface we touch. Playwright is an
 * optional peer, so its types are never imported — a type-only import would still
 * fail typecheck for a consumer that did not install it.
 */
export type PageHandle = {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  content(): Promise<string>
  url(): string
  close(): Promise<void>
}

export type ContextHandle = {
  newPage(): Promise<unknown>
  close(): Promise<void>
  route?(pattern: string, handler: (route: RouteHandle) => Promise<void> | void): Promise<void>
}

export type RouteHandle = {
  request(): { url(): string; isNavigationRequest(): boolean }
  abort(reason?: string): Promise<void>
  continue(): Promise<void>
}

export type BrowserHandle = {
  newContext(options?: Record<string, unknown>): Promise<ContextHandle>
  close(): Promise<void>
}

export type BrowserType = {
  launch(options?: { headless?: boolean; args?: string[] }): Promise<BrowserHandle>
}

function isModuleNotFound(message: string): boolean {
  return (
    /cannot find (package|module) ['"]?playwright/i.test(message) ||
    /ERR_MODULE_NOT_FOUND/i.test(message) ||
    /failed to resolve ['"]?playwright/i.test(message)
  )
}

export async function importChromium(): Promise<BrowserType> {
  try {
    const playwright = (await import('playwright')) as unknown as { chromium: BrowserType }
    return playwright.chromium
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new SidecarError(
      `Playwright is not installed. Run \`yarn add playwright\` then \`npx playwright install chromium\`.\nUnderlying: ${message}`,
      isModuleNotFound(message) ? 'needs-install' : 'init',
    )
  }
}

const MAX_VERDICT_CACHE = 2048

/**
 * Blocks private-origin navigations for the life of the context.
 *
 * The parent and the sidecar both vet the URL before a `goto`, but a page reached
 * through a legitimate public navigation can redirect or script-navigate itself
 * to a metadata endpoint, and those hops never pass through the RPC layer.
 *
 * Fails closed: Chromium resolves names with its own resolver, so a hostname
 * `node:dns` cannot vet must not be allowed through on the assumption it is dead.
 */
export async function installNavigationGuard(
  context: ContextHandle,
  options: { filterSubresources?: boolean; warn?: (message: string) => void } = {},
): Promise<void> {
  if (typeof context.route !== 'function') {
    options.warn?.('context.route() unavailable — in-page navigation SSRF guard NOT installed')
    return
  }
  const filterSubresources = options.filterSubresources ?? false
  const verdicts = new Map<string, boolean>()
  const remember = (host: string, blocked: boolean): void => {
    if (verdicts.size >= MAX_VERDICT_CACHE) {
      const oldest = verdicts.keys().next().value
      if (oldest !== undefined) verdicts.delete(oldest)
    }
    verdicts.set(host, blocked)
  }

  await context.route('**/*', async (route) => {
    const request = route.request()
    const isNavigation = request.isNavigationRequest()
    if (!isNavigation && !filterSubresources) return route.continue()

    const url = request.url()
    let host: string
    try {
      host = new URL(url).host
    } catch {
      return isNavigation ? route.abort('blockedbyclient') : route.continue()
    }

    const cached = isNavigation ? undefined : verdicts.get(host)
    if (cached === true) return route.abort('blockedbyclient')
    if (cached === false) return route.continue()

    try {
      await assertPublicUrl(url, isNavigation ? 'browser navigation' : 'browser subresource', {
        failClosed: true,
      })
      remember(host, false)
    } catch {
      remember(host, true)
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
}

/**
 * Launch flags aimed at not announcing automation. Playwright's defaults set
 * `navigator.webdriver` and a headless UA, which the SERP endpoints this adapter
 * exists to reach specifically look for.
 */
export const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
]

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
