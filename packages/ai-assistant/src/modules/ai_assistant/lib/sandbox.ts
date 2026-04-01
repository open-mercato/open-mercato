/**
 * Sandboxed Code Execution Engine
 *
 * Uses isolated-vm to run AI-generated JavaScript inside a separate V8 isolate.
 * Each execution gets a fresh isolate with no shared prototype chain, heap, or
 * handle access to the host process — preventing the node:vm escape via the
 * Promise prototype chain (NEW-01, CVSS 9.9).
 */

import ivm from 'isolated-vm'

export interface SandboxOptions {
  /** Execution timeout in milliseconds (default: 30_000) */
  timeout?: number
  /** Maximum output size in bytes (default: 1_048_576 / 1MB) */
  maxOutputSize?: number
  /** Maximum number of api.request() calls allowed (default: 50) */
  maxApiCalls?: number
}

export interface SandboxResult {
  result: unknown
  error?: string
  logs: string[]
  durationMs: number
  apiCallCount?: number
}

const MEMORY_LIMIT_MB = parseInt(process.env.SANDBOX_MEMORY_MB ?? '32', 10)
const MAX_LOG_ENTRIES = 100
const MAX_LOG_ENTRY_LENGTH = 1000

/**
 * Create a sandboxed execution environment.
 *
 * @param globals - Custom globals to inject (e.g., spec, api, context)
 * @param options - Sandbox configuration
 */
export function createSandbox(globals: Record<string, unknown>, options: SandboxOptions = {}) {
  const { timeout = 30_000 } = options

  return {
    async execute(code: string): Promise<SandboxResult> {
      const logs: string[] = []
      const start = Date.now()

      const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB })

      try {
        const ctx = await isolate.createContext()

        // Console proxy — fire-and-forget so logging never blocks the isolate
        await bootstrapConsole(ctx, logs)

        // Inject caller-provided globals (spec, api, context, etc.)
        await injectGlobals(ctx, globals)

        // Shadow globalThis so user code cannot navigate to the isolate's global
        // object and inspect/escape via its properties
        await ctx.global.set('globalThis', undefined)

        const normalized = normalizeCode(code)

        const script = await isolate.compileScript(`(${normalized})()`)

        // promise: true  — user code is async; awaits the returned Promise
        // copy: true     — structured-clones the result back to the outer heap
        //                  before isolate.dispose() is called; required for
        //                  object/array returns (primitives work without it)
        const result = await Promise.race([
          script.run(ctx, { promise: true, copy: true }),
          new Promise<never>((_, reject) =>
            globalThis.setTimeout(
              () => reject(new Error(`Execution timed out after ${timeout}ms`)),
              timeout
            )
          ),
        ])

        return {
          result,
          logs,
          durationMs: Date.now() - start,
        }
      } catch (error) {
        return {
          result: null,
          error: error instanceof Error ? error.message : String(error),
          logs,
          durationMs: Date.now() - start,
        }
      } finally {
        // Always release the V8 isolate to avoid memory leaks
        isolate.dispose()
      }
    },
  }
}

/**
 * Normalize AI-generated code: strip markdown fencing and validate shape.
 */
export function normalizeCode(code: string): string {
  let normalized = code.trim()

  // Strip markdown code fences
  normalized = normalized
    .replace(/^```(?:javascript|js|typescript|ts)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()

  // Auto-wrap bare code into async arrow functions
  if (!/^\s*async\s*\(/.test(normalized)) {
    // Detect statement-leading keywords — these cannot follow `return`
    const isStatement =
      /^\s*(const|let|var|for|while|if|try|switch|return|throw|class|function)\b/.test(normalized)
    normalized = isStatement
      ? `async () => { ${normalized} }`
      : `async () => { return ${normalized} }`
  }

  return normalized
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Inject a console proxy into the isolate that forwards to the outer logs array.
 * Uses applyIgnored (fire-and-forget) so logging never blocks the isolate event loop.
 */
async function bootstrapConsole(ctx: ivm.Context, logs: string[]): Promise<void> {
  const logRef = new ivm.Reference((...args: unknown[]) => pushLog(logs, args))
  const infoRef = new ivm.Reference((...args: unknown[]) => pushLog(logs, args))
  const warnRef = new ivm.Reference((...args: unknown[]) => pushLog(logs, args))
  const errorRef = new ivm.Reference((...args: unknown[]) => pushLog(logs, args))
  const debugRef = new ivm.Reference((...args: unknown[]) => pushLog(logs, args))

  await ctx.evalClosure(
    `globalThis.console = {
      log:   (...a) => $0.applyIgnored(undefined, a, { arguments: { copy: true } }),
      info:  (...a) => $1.applyIgnored(undefined, a, { arguments: { copy: true } }),
      warn:  (...a) => $2.applyIgnored(undefined, a, { arguments: { copy: true } }),
      error: (...a) => $3.applyIgnored(undefined, a, { arguments: { copy: true } }),
      debug: (...a) => $4.applyIgnored(undefined, a, { arguments: { copy: true } }),
    }`,
    [logRef, infoRef, warnRef, errorRef, debugRef],
    { arguments: { reference: true } }
  )
}

/**
 * Inject all caller-provided globals into the isolate context.
 *
 * Strategy per value type:
 *   null / undefined / primitive → jail.set directly
 *   function                     → ivm.Reference + async evalClosure wrapper
 *   object                       → split: data properties via ExternalCopy,
 *                                  function properties via ivm.Reference wrappers
 */
async function injectGlobals(
  ctx: ivm.Context,
  globals: Record<string, unknown>
): Promise<void> {
  const jail = ctx.global

  for (const [key, value] of Object.entries(globals)) {
    if (value === null || value === undefined) {
      await jail.set(key, value as null | undefined)
      continue
    }

    if (typeof value === 'function') {
      const ref = new ivm.Reference(value as (...a: unknown[]) => unknown)
      await ctx.evalClosure(
        `globalThis[${JSON.stringify(key)}] = async function(...args) {
          return await $0.apply(undefined, args, {
            arguments: { copy: true },
            result: { promise: true, copy: true },
          })
        }`,
        [ref],
        { arguments: { reference: true } }
      )
      continue
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const dataEntries: Record<string, unknown> = {}
      const fnEntries: Array<{ prop: string; ref: ivm.Reference<unknown> }> = []

      for (const [prop, propVal] of Object.entries(obj)) {
        if (typeof propVal === 'function') {
          fnEntries.push({
            prop,
            ref: new ivm.Reference(propVal as (...a: unknown[]) => unknown),
          })
        } else {
          dataEntries[prop] = propVal
        }
      }

      // Copy data properties into the isolate
      await jail.set(key, new ivm.ExternalCopy(dataEntries).copyInto())

      // Add function-property wrappers one by one
      for (const { prop, ref } of fnEntries) {
        await ctx.evalClosure(
          `globalThis[${JSON.stringify(key)}][${JSON.stringify(prop)}] = async function(...args) {
            return await $0.apply(undefined, args, {
              arguments: { copy: true },
              result: { promise: true, copy: true },
            })
          }`,
          [ref],
          { arguments: { reference: true } }
        )
      }
      continue
    }

    // Primitive (string, number, boolean)
    await jail.set(key, value as string | number | boolean)
  }
}

function pushLog(logs: string[], args: unknown[]): void {
  if (logs.length >= MAX_LOG_ENTRIES) return

  const message = args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')

  logs.push(
    message.length > MAX_LOG_ENTRY_LENGTH
      ? message.slice(0, MAX_LOG_ENTRY_LENGTH) + '...'
      : message
  )
}
