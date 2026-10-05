import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export type AdminTargetOrganizationResult =
  | { ok: true; organizationId: string }
  | { ok: false; response: Response }

/**
 * Resolves the organization a staff-initiated customer-accounts write targets.
 *
 * An explicitly requested organization is honored only when the organization-scope
 * resolver grants it for the caller's own tenant (it must exist, not be deleted, and
 * sit inside the caller's allowed organization set). Without a request the caller's
 * active organization is used, falling back to the actor's own organization under an
 * "all organizations" selection.
 */
export async function resolveAdminTargetOrganization({
  container,
  auth,
  request,
  requestedOrganizationId,
}: {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  request: Request
  requestedOrganizationId?: string | null
}): Promise<AdminTargetOrganizationResult> {
  const requested = typeof requestedOrganizationId === 'string' && requestedOrganizationId.trim().length > 0
    ? requestedOrganizationId.trim()
    : null

  if (!requested) {
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return { ok: false, response: organizationScopeRequiredResponse() }
    return { ok: true, organizationId }
  }

  const scope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request,
    selectedId: requested,
    tenantId: auth.tenantId ?? null,
  })
  if (scope.selectionRejected || scope.selectedId !== requested || scope.tenantId !== (auth.tenantId ?? null)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Organization not found' }, { status: 400 }),
    }
  }
  return { ok: true, organizationId: requested }
}
