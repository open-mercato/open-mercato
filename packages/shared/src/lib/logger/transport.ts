import type { Logger } from './index'
import { createConsoleLogger } from './transport.console'
import { createServerLogger } from './transport.server'

function isNodeServerRuntime(): boolean {
  if (typeof window !== 'undefined') return false
  if (typeof process === 'undefined') return false
  if (process.env.NEXT_RUNTIME === 'edge') return false
  return true
}

/** Pick the runtime-appropriate transport: pino on the Node server, console elsewhere. */
export function selectTransport(namespace: string): Logger {
  return isNodeServerRuntime() ? createServerLogger(namespace) : createConsoleLogger(namespace)
}
