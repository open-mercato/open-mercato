import { spawn } from 'node:child_process'
import { assertPublicUrl } from '@open-mercato/web-research'
import { SidecarError } from './protocol'

/**
 * Structural projections of the Playwright surface we touch.
 *
 * Playwright is a real dependency of this package — installing the adapter gets
 * you the tooling it needs — but it is still reached through a dynamic import
 * inside the sidecar, so the app and MCP processes never load it. The types stay
 * structural for the same reason: nothing here should pull the SDK into a bundle
 * that only ever spawns the child.
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
    // Playwright is a dependency of this package, so a module-not-found here
    // means a broken install (hoisting, a pruned image layer), not a missing opt-in.
    throw new SidecarError(
      `Playwright could not be loaded even though it is a dependency of this package — reinstall dependencies. Underlying: ${message}`,
      isModuleNotFound(message) ? 'needs-install' : 'init',
    )
  }
}

/**
 * Playwright's launch error when the npm package is installed but the browser
 * binary was never downloaded. The wording has been stable across 1.x, and it is
 * the only signal Playwright gives for this case.
 */
function isMissingBrowserError(error: unknown): boolean {
  return error instanceof Error && /Executable doesn'?t exist at/i.test(error.message)
}

/** Generous, but bounded — an unbounded install hangs the sidecar forever. */
const INSTALL_TIMEOUT_MS = 10 * 60_000

export type InstallRunner = (onProgress: (line: string) => void) => Promise<void>

const defaultInstallRunner: InstallRunner = async (onProgress) =>
  new Promise((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'install', 'chromium'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const collect = (chunk: Buffer): void => {
      tail = `${tail}${chunk.toString('utf8')}`.slice(-4000)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`\`npx playwright install chromium\` exceeded ${INSTALL_TIMEOUT_MS}ms`))
    }, INSTALL_TIMEOUT_MS)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        onProgress('chromium install complete')
        resolve()
        return
      }
      reject(new Error(`\`npx playwright install chromium\` failed (exit ${code}): ${tail.trim()}`))
    })
  })

/**
 * Launches Chromium, downloading the binary once if it is missing.
 *
 * Installing the npm package does not fetch the ~150MB browser, so an operator
 * who enables this tier would otherwise hit a launch failure with no obvious
 * remedy. One retry only — a second failure is a real fault, not a cold cache.
 */
export async function launchChromium(
  browserType: BrowserType,
  options: { headless?: boolean; args?: string[] },
  deps: { install?: InstallRunner; onProgress?: (line: string) => void } = {},
): Promise<BrowserHandle> {
  try {
    return await browserType.launch(options)
  } catch (error) {
    // Deliberately not retried without the sandbox. Falling back silently would
    // mean the security posture depends on whether a container happened to be
    // configured, with nobody told which one they got.
    if (isSandboxFailure(error)) {
      throw new SidecarError(
        `Chromium could not start its sandbox, and this adapter renders untrusted pages so it will not run without one. ` +
          `Fix the container (run as a non-root user, or grant SYS_ADMIN, or enable user namespaces), ` +
          `or accept the risk explicitly with ${SANDBOX_OPT_OUT_ENV}=1. Underlying: ${error instanceof Error ? error.message : String(error)}`,
        'init',
      )
    }
    if (!isMissingBrowserError(error)) throw error
    const onProgress = deps.onProgress ?? (() => {})
    onProgress('chromium binary missing, running `npx playwright install chromium` (one-time, ~150MB)')
    try {
      await (deps.install ?? defaultInstallRunner)(onProgress)
    } catch (installError) {
      const detail = installError instanceof Error ? installError.message : String(installError)
      throw new SidecarError(
        `Playwright browser auto-install failed: ${detail}. Run \`npx playwright install chromium\` manually.`,
        'init',
      )
    }
    return await browserType.launch(options)
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
 *
 * `--disable-dev-shm-usage` is a sizing workaround, not a security control: it
 * makes Chromium write shared memory to /tmp instead of a container's small
 * /dev/shm. The sandbox is deliberately NOT disabled here — see
 * {@link resolveLaunchArgs}.
 */
export const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
]

export const SANDBOX_OPT_OUT_ENV = 'OM_WEB_RESEARCH_BROWSER_NO_SANDBOX'

/**
 * Launch flags for this process, sandbox included unless an operator opted out.
 *
 * This adapter exists to render pages chosen by a search engine or a model, so
 * the renderer is by definition parsing hostile input. `--no-sandbox` turns a
 * renderer compromise into code running as whatever user the app runs as, which
 * is the one mitigation Chromium provides for exactly this threat.
 *
 * It used to be on unconditionally because the sandbox needs privileges a
 * root-in-Docker container does not grant by default. That is a container
 * problem with container fixes (run as a non-root user, or grant `SYS_ADMIN`, or
 * enable user namespaces); silently shipping every deployment the insecure
 * variant to spare those is the wrong trade. The opt-out stays available for
 * environments that genuinely cannot, and it is loud.
 */
export function resolveLaunchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return env[SANDBOX_OPT_OUT_ENV] === '1' ? [...LAUNCH_ARGS, '--no-sandbox'] : [...LAUNCH_ARGS]
}

export function isSandboxDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SANDBOX_OPT_OUT_ENV] === '1'
}

/**
 * Chromium's refusal when it cannot set up its sandbox. The wording differs
 * between the root check and the namespace failure, so both shapes are matched.
 */
export function isSandboxFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    /running as root without --no-sandbox/i.test(error.message) ||
    /No usable sandbox/i.test(error.message) ||
    /clone helper|namespace sandbox|SUID sandbox/i.test(error.message)
  )
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
