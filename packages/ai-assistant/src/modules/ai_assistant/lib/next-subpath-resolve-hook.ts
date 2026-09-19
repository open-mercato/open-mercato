/**
 * Node ESM resolution for `next/<subpath>` in the standalone MCP processes (#6238 / #6118).
 *
 * `mercato ai_assistant mcp:serve-http` (and `mcp:serve`, `mcp:dev`,
 * `mcp:list-tools`) run in plain Node, and the AI API operation runner loads
 * API route modules with a runtime `import()`. Those modules import
 * `NextResponse` from `'next/server'`: a bare package subpath that only a
 * bundler resolves, because `next` ships no `exports` map and Node's ESM
 * resolver does no extension guessing. Every route with that import (287 of
 * them on the 0.7.0 packages) therefore fails to load with
 * `ERR_MODULE_NOT_FOUND … node_modules/next/server`, and every tool backed by
 * such a route returns "Failed to load route module".
 *
 * `next/server.js`, `next/headers.js`, `next/navigation.js` … do exist as files,
 * which is why `@open-mercato/shared` imports `'next/headers.js'`. Rather than
 * rewriting several hundred imports across every package (and every
 * third-party module), this hook retries a failed bare `next/<subpath>` with
 * the `.js` suffix. It only runs in the processes that install it, only for
 * `next/*` specifiers, and only after the normal resolution failed, so it
 * becomes a no-op the day `next` publishes an `exports` map.
 */
import * as nodeModule from 'node:module'

type ResolveContext = Record<string, unknown>
type ResolveResult = { url: string; format?: string | null | undefined; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: ResolveContext) => ResolveResult
type AsyncNextResolve = (specifier: string, context?: ResolveContext) => ResolveResult | Promise<ResolveResult>

/** Bare `next/<one segment>` specifiers, e.g. `next/server`, `next/headers`. */
const NEXT_BARE_SUBPATH = /^next\/[A-Za-z0-9_-]+$/

let installed = false

function isModuleNotFound(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND'
}

/**
 * The resolve hook itself. Exported so it can be tested without touching the
 * process-global hook chain.
 */
export function resolveNextSubpath(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): ResolveResult {
  if (!NEXT_BARE_SUBPATH.test(specifier)) return nextResolve(specifier, context)
  try {
    return nextResolve(specifier, context)
  } catch (error) {
    if (!isModuleNotFound(error)) throw error
    try {
      return nextResolve(`${specifier}.js`, context)
    } catch {
      // Neither form resolves (Next is not installed at all): surface the
      // original error, which names the specifier the caller wrote.
      throw error
    }
  }
}

export async function resolveNextSubpathAsync(
  specifier: string,
  context: ResolveContext,
  nextResolve: AsyncNextResolve,
): Promise<ResolveResult> {
  if (!NEXT_BARE_SUBPATH.test(specifier)) return nextResolve(specifier, context)
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!isModuleNotFound(error)) throw error
    try {
      return await nextResolve(`${specifier}.js`, context)
    } catch {
      throw error
    }
  }
}

type RegisterHooks = (hooks: { resolve: typeof resolveNextSubpath }) => unknown
type RegisterHookModule = (specifier: string | URL, parentURL?: string | URL) => unknown

/**
 * `module.registerHooks` exists from Node 22.15. It is read off the namespace
 * rather than imported by name: in the published ESM build a named import of an
 * export the running Node lacks fails while the module links, before the check
 * in `installNextSubpathResolveHook` can run, and the package still declares
 * `node >= 22.0.0`.
 */
function runtimeRegisterHooks(): RegisterHooks | undefined {
  const candidate = (nodeModule as unknown as { registerHooks?: unknown }).registerHooks
  return typeof candidate === 'function' ? (candidate as RegisterHooks) : undefined
}

function runtimeRegisterHookModule(): RegisterHookModule | undefined {
  const candidate = (nodeModule as unknown as { register?: unknown }).register
  return typeof candidate === 'function' ? (candidate as RegisterHookModule) : undefined
}

/**
 * Install the hook once per process. Returns `true` when it was installed by
 * this call, `false` when it already was or when the runtime has neither
 * registration API. Node 22.15+ uses the synchronous hook API; earlier
 * supported Node 22 releases use the asynchronous hook API.
 */
export function installNextSubpathResolveHook(
  registerHooks: RegisterHooks | null | undefined = runtimeRegisterHooks(),
  registerHookModule: RegisterHookModule | null | undefined = runtimeRegisterHookModule(),
): boolean {
  if (installed) return false
  if (typeof registerHooks === 'function') {
    registerHooks({ resolve: resolveNextSubpath })
  } else if (typeof registerHookModule === 'function') {
    registerHookModule(new URL('./next-subpath-resolve-hook-worker.js', import.meta.url), import.meta.url)
  } else {
    return false
  }
  installed = true
  return true
}

/** Test seam: forget that the hook was installed. */
export function resetNextSubpathResolveHookForTests(): void {
  installed = false
}
