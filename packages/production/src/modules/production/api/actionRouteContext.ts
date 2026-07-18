import type { NextRequest } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

/**
 * Resolves a `CommandRuntimeContext` for the custom BOM/routing action routes
 * (activate, copy-version). Uses `resolveOrganizationScopeForRequest` — the
 * same seam `sales/api/quotes/send/route.ts` uses — instead of trusting
 * `auth.orgId` directly, so multi-org users acting on a non-default
 * organization (via the selected-organization cookie/header) are scoped
 * correctly rather than silently falling back to their default org.
 */
export async function resolveProductionActionContext(req: NextRequest): Promise<{ ctx: CommandRuntimeContext }> {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    throw new CrudHttpError(401, { error: translate('production.errors.unauthorized', 'Unauthorized') })
  }
  if (!auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('production.errors.unauthorized', 'Unauthorized') })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('production.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx }
}
