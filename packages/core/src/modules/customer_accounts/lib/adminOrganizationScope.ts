import { NextResponse } from 'next/server'
import { z } from 'zod'
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

const organizationIdSchema = z.string().uuid()

function organizationNotFound(): AdminTargetOrganizationResult {
  return {
    ok: false,
    response: NextResponse.json({ ok: false, error: 'Organization not found' }, { status: 400 }),
  }
}

/**
 * Resolves the organization a staff-initiated customer-accounts write targets.
 *
 * Without a request the caller's active organization is used, falling back to the
 * actor's own organization under an "all organizations" selection.
 *
 * An explicitly requested organization is honored only when the organization-scope
 * resolver grants it for the caller's own tenant: it must exist, not be deleted, and
 * sit inside the caller's allowed organization set.
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
  const activeOrganizationId = resolveActiveOrganizationId(auth)

  if (!requested) {
    if (!activeOrganizationId) return { ok: false, response: organizationScopeRequiredResponse() }
    return { ok: true, organizationId: activeOrganizationId }
  }

  if (!organizationIdSchema.safeParse(requested).success) return organizationNotFound()
  if (requested === activeOrganizationId) return { ok: true, organizationId: requested }

  const scope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request,
    selectedId: requested,
    tenantId: auth.tenantId ?? null,
  })
  if (scope.selectionRejected || scope.selectedId !== requested || scope.tenantId !== (auth.tenantId ?? null)) {
    return organizationNotFound()
  }
  return { ok: true, organizationId: requested }
}
