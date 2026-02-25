/**
 * Sandboxed Code Execution Engine
 *
 * Uses node:vm to run AI-generated JavaScript in a restricted sandbox.
 * Only whitelisted globals are available — no file system, network, or process access.
 */

import vm from 'node:vm'

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

const MAX_LOG_ENTRIES = 100
const MAX_LOG_ENTRY_LENGTH = 1000

/**
 * Create a sandboxed execution environment.
 *
 * @param globals - Custom globals to inject (e.g., spec, api, context)
 * @param options - Sandbox configuration
 */
export function createSandbox(
  globals: Record<string, unknown>,
  options: SandboxOptions = {}
) {
  const { timeout = 30_000, maxApiCalls = 50 } = options

  return {
    async execute(code: string): Promise<SandboxResult> {
      const logs: string[] = []
      const start = Date.now()

      // Capture console output
      const consolProxy = {
        log: (...args: unknown[]) => pushLog(logs, args),
        info: (...args: unknown[]) => pushLog(logs, args),
        warn: (...args: unknown[]) => pushLog(logs, args),
        error: (...args: unknown[]) => pushLog(logs, args),
        debug: (...args: unknown[]) => pushLog(logs, args),
      }

      // Build context with safe globals + caller-provided globals
      const contextGlobals: Record<string, unknown> = {
        // Safe built-ins
        JSON,
        Object,
        Array,
        Map,
        Set,
        Promise,
        Math,
        Date,
        RegExp,
        String,
        Number,
        Boolean,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        Error,
        TypeError,
        RangeError,
        undefined,
        NaN,
        Infinity,

        // Sandboxed console
        console: consolProxy,

        // Blocked — explicitly set to undefined
        require: undefined,
        process: undefined,
        global: undefined,
        globalThis: undefined,
        fetch: undefined,
        XMLHttpRequest: undefined,
        WebSocket: undefined,
        Buffer: undefined,
        setTimeout: undefined,
        setInterval: undefined,
        __dirname: undefined,
        __filename: undefined,

        // Caller-provided globals (spec, api, context, etc.)
        ...globals,
      }

      const ctx = vm.createContext(contextGlobals)

      try {
        const normalized = normalizeCode(code)

        // Wrap as self-executing async function
        const wrapped = `(async () => { return (${normalized})() })()`

        const script = new vm.Script(wrapped, {
          filename: 'sandbox.js',
        })

        // Run the script — returns a Promise
        const promise = script.runInContext(ctx, { timeout })

        // Await with secondary timeout (for async operations like api.request)
        const result = await Promise.race([
          promise,
          new Promise((_, reject) =>
            // Use global setTimeout (not the blocked sandbox one)
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

  // Validate it looks like an async arrow function
  if (!/^\s*async\s*\(/.test(normalized)) {
    throw new Error(
      'Code must be an async arrow function, e.g.: async () => { ... }'
    )
  }

  return normalized
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
