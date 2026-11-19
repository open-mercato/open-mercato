import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { withScopedPayload, type ScopedContext } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export const AVAILABILITY_POLICY_ORGANIZATION_REQUIRED_MESSAGE = {
  key: 'availability.policies.errors.organizationRequired',
  fallback: 'Select a specific organization in the header before creating a policy.',
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
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request }).catch(() => null)
  return scope?.selectedId ?? resolveActiveOrganizationId(auth)
}

// The policy list reads the organization selected in the header, or under "All
// organizations" every organization the caller may access, as the `makeCrudRoute` lists do.
// `null` means the whole tenant; an empty array means no organization is in scope.
export async function resolveAvailabilityListOrganizationIds(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<string[] | null> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request }).catch(() => null)
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
