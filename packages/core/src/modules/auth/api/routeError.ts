import { NextResponse } from 'next/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('auth.api')

export type AuthRouteErrorOptions = {
  /** Stable identifier for the failing route, e.g. `auth.login`. Logged, never returned. */
  scope: string
  /** Already-translated, user-safe message. Must not describe the underlying failure. */
  message: string
}

/**
 * Last-resort handler for an unexpected throw inside a public auth route.
 *
 * Without this, an infrastructure failure (database unreachable, DI container
 * unable to build, a missing signing secret) escapes the handler and Next.js
 * answers with a bare 500 carrying no body at all — nothing for the client to
 * render and nothing in the response to tell an operator what broke. The
 * failure then looks identical to a bug in the route itself.
 *
 * The cause is logged server-side under a stable scope so it is greppable in
 * deployment logs; the response stays deliberately generic, because auth
 * responses must never let an unauthenticated caller distinguish one failure
 * from another.
 */
export function handleAuthRouteError(error: unknown, options: AuthRouteErrorOptions): NextResponse {
  logger.error('Unhandled auth route error', { err: error, scope: options.scope })
  return NextResponse.json({ ok: false, error: options.message }, { status: 500 })
}
