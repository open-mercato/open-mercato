import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { NextResponse } from 'next/server'
import type { HistoryScope } from '../../services/generation-history-service'

/** Success/failure discriminated union used by the HTTP guards below. */
type Guard<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

/**
 * Parses the request JSON body, returning a 400 response on malformed input.
 * Keeps the `invalid_json` response contract identical across routes.
 */
export async function parseJsonBody(request: Request, translate: TranslateFn): Promise<Guard<unknown>> {
  try {
    return { ok: true, value: await request.json() }
  } catch {
    return {
      ok: false,
      response: NextResponse.json({
        error: 'invalid_json',
        message: translate('document_generators.errors.invalid_json', 'The request body must contain valid JSON.'),
      }, { status: 400 }),
    }
  }
}

/**
 * Requires an active organization (tenant + org). Returns a 409
 * `organization_required` response otherwise, with the scope on success.
 */
export function requireOrganization(auth: AuthContext | null, translate: TranslateFn): Guard<HistoryScope> {
  if (!auth?.tenantId || !auth?.orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'organization_required',
          message: translate('document_generators.errors.organization_required', 'Select an organization to generate this document.'),
        },
        { status: 409 },
      ),
    }
  }
  return { ok: true, value: { organizationId: auth.orgId, tenantId: auth.tenantId } }
}
