import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { WarrantyClaim } from '../../../../data/entities'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../../../commands/shared'
import { loadPortalOwnedClaim } from '../../../../lib/portalClaimAccess'
import { resolveLinkedCustomerAuth } from '../../../../lib/portalAuthGuard'

export type PortalClaimActionRouteContext = { params: Promise<{ id: string }> }

export type PortalClaimActionContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  em: EntityManager
  commandCtx: CommandRuntimeContext
}

const claimIdParamSchema = z.string().uuid()

export async function resolvePortalClaimId(ctx: PortalClaimActionRouteContext): Promise<string | null> {
  try {
    const params = await ctx.params
    const parsed = claimIdParamSchema.safeParse(typeof params.id === 'string' ? params.id.trim() : params.id)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function resolvePortalActionContext(req: Request): Promise<PortalClaimActionContext | Response> {
  const authOrResponse = await resolveLinkedCustomerAuth(req)
  if (authOrResponse instanceof Response) return authOrResponse
  const auth = authOrResponse
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandAuth: NonNullable<AuthContext> = {
    sub: auth.sub,
    sid: auth.sid,
    tenantId: auth.tenantId,
    orgId: auth.orgId,
    email: auth.email,
    customerEntityId: auth.customerEntityId ?? null,
    personEntityId: auth.personEntityId ?? null,
  }
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em,
    commandCtx: {
      container,
      auth: commandAuth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId,
      organizationIds: [auth.orgId],
      request: req,
    },
  }
}

export async function loadOwnedClaim(
  context: PortalClaimActionContext,
  claimId: string,
): Promise<WarrantyClaim | null> {
  return loadPortalOwnedClaim(
    context.em,
    {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      customerId: context.customerId,
    },
    claimId,
  )
}

export async function loadOwnedClaimFresh(
  context: PortalClaimActionContext,
  claimId: string,
): Promise<WarrantyClaim | null> {
  const em = context.em.fork()
  return loadPortalOwnedClaim(
    em,
    {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      customerId: context.customerId,
    },
    claimId,
  )
}

export async function runPortalClaimActionGuard(
  req: Request,
  context: PortalClaimActionContext,
  claimId: string,
  mutationPayload: Record<string, unknown>,
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: context.commandCtx.container,
    req,
    auth: {
      userId: context.auth.sub,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userFeatures: [],
    },
    input: {
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: claimId,
      operation: 'custom',
      mutationPayload,
    },
  })
}
