import type { LogBindings, Logger } from './index'
import { getLogLevel } from './level'
import { createConsoleLogger } from './transport.console'

const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
]

const REDACT_CENSOR = '[Redacted]'

type PinoBaseLogger = {
  debug(fields: Record<string, unknown>, msg: string): void
  info(fields: Record<string, unknown>, msg: string): void
  warn(fields: Record<string, unknown>, msg: string): void
  error(fields: Record<string, unknown>, msg: string): void
  child(bindings: Record<string, unknown>): PinoBaseLogger
}

type PinoFactory = (options: Record<string, unknown>) => PinoBaseLogger

type NodeModuleBuiltin = {
  createRequire(basePath: string): (id: string) => unknown
}

type ProcessWithBuiltins = {
  cwd(): string
  getBuiltinModule?(id: string): unknown
}

let cachedRoot: PinoBaseLogger | null | undefined

/**
 * pino is loaded lazily via a runtime `require` obtained from
 * `process.getBuiltinModule('node:module')` — never through a static import —
 * so browser/edge bundles that reach this file never resolve pino or
 * `node:module`. Any load failure falls back to the console transport.
 */
function loadPinoRoot(): PinoBaseLogger | null {
  if (cachedRoot !== undefined) return cachedRoot
  try {
    const nodeProcess = (typeof process === 'undefined' ? undefined : process) as
      | ProcessWithBuiltins
      | undefined
    const moduleBuiltin = nodeProcess?.getBuiltinModule?.('node:module') as
      | NodeModuleBuiltin
      | undefined
    if (!nodeProcess || !moduleBuiltin) {
      cachedRoot = null
      return cachedRoot
    }
    const requireFromApp = moduleBuiltin.createRequire(`${nodeProcess.cwd()}/package.json`)
    const pinoExport = requireFromApp('pino') as PinoFactory | { default: PinoFactory }
    const pinoFactory = typeof pinoExport === 'function' ? pinoExport : pinoExport.default
    cachedRoot = pinoFactory({
      level: getLogLevel(),
      redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    })
  } catch {
    cachedRoot = null
  }
  return cachedRoot
}

function wrapPinoLogger(pinoLogger: PinoBaseLogger): Logger {
  return {
    debug: (msg, fields) => pinoLogger.debug(fields ?? {}, msg),
    info: (msg, fields) => pinoLogger.info(fields ?? {}, msg),
    warn: (msg, fields) => pinoLogger.warn(fields ?? {}, msg),
    error: (msg, fields) => pinoLogger.error(fields ?? {}, msg),
    child: (childBindings) => wrapPinoLogger(pinoLogger.child(childBindings)),
  }
}

export function createServerLogger(namespace: string, bindings: LogBindings = {}): Logger {
  let delegate: Logger | null = null
  const resolveDelegate = (): Logger => {
    if (delegate) return delegate
    const root = loadPinoRoot()
    delegate = root
      ? wrapPinoLogger(root.child({ name: namespace, ...bindings }))
      : createConsoleLogger(namespace, bindings)
    return delegate
  }
  return {
    debug: (msg, fields) => resolveDelegate().debug(msg, fields),
    info: (msg, fields) => resolveDelegate().info(msg, fields),
    warn: (msg, fields) => resolveDelegate().warn(msg, fields),
    error: (msg, fields) => resolveDelegate().error(msg, fields),
    child: (childBindings) => createServerLogger(namespace, { ...bindings, ...childBindings }),
  }
}

/** Internal: clear the cached pino root so tests can re-run transport selection. */
export function resetServerLoggerCache(): void {
  cachedRoot = undefined
}
