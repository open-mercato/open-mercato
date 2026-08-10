import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { NextResponse } from 'next/server'
import type { HistoryScope } from '../../services/generation-history-service'

/** Success/failure discriminated union used by the HTTP guards below. */
type Guard<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

/**
 * Parses the request JSON body, returning a 400 response on malformed input.
 * Keeps the "Invalid JSON body" contract identical across routes.
 */
export async function parseJsonBody(request: Request): Promise<Guard<unknown>> {
  try {
    return { ok: true, value: await request.json() }
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  }
}

/**
 * Requires an active organization (tenant + org). Returns a 409
 * `organization_required` response otherwise, with the scope on success.
 */
export function requireOrganization(auth: AuthContext | null): Guard<HistoryScope> {
  if (!auth?.tenantId || !auth?.orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'organization_required', message: 'Select an organization to generate this document.' },
        { status: 409 },
      ),
    }
  }
  return { ok: true, value: { organizationId: auth.orgId, tenantId: auth.tenantId } }
}
