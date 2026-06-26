import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'

export const ENTITY_DEFINITION_RESOURCE_KIND = 'entities.entity'
export const FIELD_DEFINITION_RESOURCE_KIND = 'entities.field_definition'

type AuthenticatedContext = NonNullable<AuthContext>

type GuardOperation = 'create' | 'update' | 'delete' | 'custom'

type EntitiesMutationGuardContext = {
  container: AwilixContainer
  auth: AuthenticatedContext
  req: Request
  resourceKind: string
  resourceId: string
  operation: GuardOperation
  mutationPayload?: Record<string, unknown> | null
}

type EntitiesMutationGuardHandle = {
  blockedResponse: NextResponse | null
  runAfterSuccess: () => Promise<void>
}

function resolveActorUserId(auth: AuthenticatedContext): string {
  return auth.userId ?? auth.sub
}

export async function beginEntitiesMutationGuard(
  ctx: EntitiesMutationGuardContext,
): Promise<EntitiesMutationGuardHandle> {
  const tenantId = ctx.auth.tenantId
  const userId = resolveActorUserId(ctx.auth)
  if (!tenantId) {
    return { blockedResponse: null, runAfterSuccess: async () => undefined }
  }

  const guardResult = await validateCrudMutationGuard(ctx.container, {
    tenantId,
    organizationId: ctx.auth.orgId ?? null,
    userId,
    resourceKind: ctx.resourceKind,
    resourceId: ctx.resourceId,
    operation: ctx.operation,
    requestMethod: ctx.req.method,
    requestHeaders: ctx.req.headers,
    mutationPayload: ctx.mutationPayload ?? null,
  })

  if (guardResult && !guardResult.ok) {
    return {
      blockedResponse: NextResponse.json(guardResult.body, { status: guardResult.status }),
      runAfterSuccess: async () => undefined,
    }
  }

  return {
    blockedResponse: null,
    runAfterSuccess: async () => {
      if (!guardResult?.ok || !guardResult.shouldRunAfterSuccess) return
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId: ctx.auth.orgId ?? null,
        userId,
        resourceKind: ctx.resourceKind,
        resourceId: ctx.resourceId,
        operation: ctx.operation,
        requestMethod: ctx.req.method,
        requestHeaders: ctx.req.headers,
        metadata: guardResult.metadata ?? null,
      })
    },
  }
}
