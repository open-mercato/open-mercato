import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isExplicitlyEmptyOrganizationScope, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { withScopedPayload, type ScopedContext } from '@open-mercato/shared/lib/api/scoped'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export const AVAILABILITY_POLICY_ORGANIZATION_REQUIRED_MESSAGE = {
  key: 'availability.policies.errors.organizationRequired',
  fallback: 'Select a specific organization in the header before creating a policy.',
}

const INVALID_ORGANIZATION_SELECTION = 'organization_selection_invalid'
const ORGANIZATION_SCOPE_UNAVAILABLE = 'organization_scope_unavailable'

async function resolveAvailabilityReadScope(container: AwilixContainer, auth: AuthContext, request: Request) {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request }).catch(async (error: unknown) => {
    reportTelemetryError(error, { module: 'availability', code: 'availability.organization_scope_resolution_failed' })
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(503, {
      error: translate('availability.errors.organizationScopeUnavailable', 'Organization access could not be verified. Try again.'),
      code: ORGANIZATION_SCOPE_UNAVAILABLE,
    })
  })
  if (!scope?.selectionRejected) return scope

  const { translate } = await resolveTranslations()
  throw new CrudHttpError(422, {
    error: translate(
      'availability.errors.organizationSelectionInvalid',
      'Your selected organization is no longer available. Please re-select an organization and try again.',
    ),
    code: INVALID_ORGANIZATION_SELECTION,
  })
}

export function withAvailabilityReadScope(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request)
    } catch (error) {
      if (!isCrudHttpError(error)) throw error
      if (error.body.code === ORGANIZATION_SCOPE_UNAVAILABLE) {
        return Response.json(error.body, { status: error.status, headers: { 'retry-after': '2' } })
      }
      if (error.body.code !== INVALID_ORGANIZATION_SELECTION) throw error
      return Response.json(error.body, {
        status: error.status,
        headers: { 'set-cookie': 'om_selected_org=; Path=/; Max-Age=0; SameSite=Lax' },
      })
    }
  }
}

// Policy writes go through `makeCrudRoute`, which scopes them to the organization
// selected in the header (`ctx.selectedOrganizationId`). `getAuthFromRequest` applies
// that selection to `auth.orgId` for superadmins only, so the hand-written reads
// resolve it the same way the CRUD factory does; otherwise a user working in a second
// organization would write policies there and read them from the home organization.
export async function resolveAvailabilityOrganizationId(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<string | null> {
  const scope = await resolveAvailabilityReadScope(container, auth, request)
  if (isExplicitlyEmptyOrganizationScope(scope)) return null
  if (scope?.selectedId) return scope.selectedId
  const fallbackOrganizationId = resolveActiveOrganizationId(auth)
  const approvedIds = scope?.filterIds ?? scope?.allowedIds
  if (approvedIds && (!fallbackOrganizationId || !approvedIds.includes(fallbackOrganizationId))) return null
  return fallbackOrganizationId
}

// The policy list reads the organization selected in the header, or under "All
// organizations" every organization the caller may access, as the `makeCrudRoute` lists do.
// `null` means the whole tenant; an empty array means no organization is in scope.
export async function resolveAvailabilityListOrganizationIds(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<string[] | null> {
  const scope = await resolveAvailabilityReadScope(container, auth, request)
  if (scope?.selectedId) return [scope.selectedId]
  if (scope?.tenantId) return scope.filterIds ?? null
  const fallbackOrganizationId = resolveActiveOrganizationId(auth)
  if (fallbackOrganizationId) return [fallbackOrganizationId]
  return auth?.isSuperAdmin ? null : []
}

// A policy belongs to exactly one organization. The create form sends the header
// selection, which is `null` under "All organizations"; fill the scope from the request
// context instead and, when no single organization is in scope, answer with a message
// the form can show rather than a field error on a field it does not render.
export async function scopeAvailabilityPolicyWriteInput(
  input: Record<string, unknown>,
  ctx: ScopedContext,
): Promise<Record<string, unknown>> {
  const { translate } = await resolveTranslations()
  return withScopedPayload(input, ctx, translate, {
    messages: { organizationRequired: AVAILABILITY_POLICY_ORGANIZATION_REQUIRED_MESSAGE },
  })
}
