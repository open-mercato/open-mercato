import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

/**
 * The command context an authored change runs under.
 *
 * Unlike the campaign engine's own context (which is a system actor), this one carries the real
 * user: authoring a campaign is a human action and belongs in the audit log with a name on it.
 */
export function buildRequestCommandContext(
  container: AwilixContainer,
  // `AuthContext` itself includes `| null` in this codebase, so the non-null form is the
  // caller's promise that it already rejected an unauthenticated request.
  auth: NonNullable<AuthContext>,
  // Threaded so `enforceCommandOptimisticLock` can read the expected-version header. Without it a
  // command that relies on the header alone (delete) silently skips the check entirely.
  request?: Request,
): CommandRuntimeContext {
  return {
    container,
    auth,
    request,
    organizationScope: null,
    selectedOrganizationId: auth.orgId ?? null,
    organizationIds: auth.orgId ? [auth.orgId] : null,
  }
}

/**
 * A uuid from a path segment, or null.
 *
 * Every route in this module reads its id out of the URL, and every one of them passed whatever it found
 * straight into a query. Postgres rejects a malformed uuid by RAISING, so `/campaigns/not-a-uuid` answered
 * 500 — which reads as a broken server rather than a bad request, wakes somebody up, and buries the actual
 * 404s and 500s in the noise. Validated here so the existing "missing id" branch answers 400 instead.
 *
 * `fromEnd` counts back from the end of the path: 1 for `/campaigns/<id>`, 2 for `/campaigns/<id>/runs`.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readPathUuid(req: Request, fromEnd = 1): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  const value = segments[segments.length - fromEnd]
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
}

/**
 * Turns a command's own HTTP error into the response it describes, and re-throws anything else.
 *
 * `CrudHttpError` is how a command says 404, 409 or 400 — the optimistic-lock conflict and "no such campaign"
 * both arrive this way. A route that does not catch it answers 500, so a stale editor was told the server had
 * broken rather than that somebody else had saved first.
 */
export function commandErrorResponse(error: unknown): NextResponse {
  if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
  throw error
}

/**
 * A uuid from a query parameter, or null — the counterpart to `readPathUuid`.
 *
 * The path version closed this hole for `/campaigns/<id>`; the same hole stayed open for `?campaignId=` and
 * `?a=`, where Postgres still rejects a malformed uuid by RAISING and the route still answers 500 to what is
 * plainly a bad request.
 */
export function readQueryUuid(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
}
