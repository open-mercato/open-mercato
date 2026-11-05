import type { Logger } from './index'
import { createConsoleLogger } from './transport.console'
import { createPrettyLogger, isPrettyModeEnabled } from './transport.pretty'
import { createServerLogger } from './transport.server'

function isNodeServerRuntime(): boolean {
  if (typeof window !== 'undefined') return false
  if (typeof process === 'undefined') return false
  if (process.env.NEXT_RUNTIME === 'edge') return false
  return true
}

/** Pick the runtime-appropriate transport: pretty or pino on the Node server, console elsewhere. */
export function selectTransport(namespace: string): Logger {
  if (!isNodeServerRuntime()) return createConsoleLogger(namespace)
  return isPrettyModeEnabled() ? createPrettyLogger(namespace) : createServerLogger(namespace)
}
