import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuardAfterInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { ReferenceScope } from '../data/validators'

type RbacService = {
  getGrantedFeatures(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<string[]>
}

export async function resolveReferenceRouteContext(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return null
  const organizationId = auth.orgId
  if (!organizationId) return null
  const container = await createRequestContainer()
  const scope: ReferenceScope = { tenantId: auth.tenantId, organizationId }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request,
  }
  return { auth, container, em: container.resolve('em') as EntityManager, scope, ctx }
}

export async function runReferenceRouteGuards(
  context: NonNullable<Awaited<ReturnType<typeof resolveReferenceRouteContext>>>,
  input: {
    resourceKind: string
    resourceId: string | null
    operation: 'create' | 'update' | 'delete'
    payload?: Record<string, unknown> | null
  },
) {
  const guards = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(context.container)
  if (legacyGuard) guards.push(legacyGuard)
  const rbac = context.container.resolve('rbacService') as RbacService
  const userFeatures = await rbac.getGrantedFeatures(context.auth.sub, context.scope)
  return runMutationGuards(
    guards,
    {
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
      userId: context.auth.sub,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      operation: input.operation,
      requestMethod: context.ctx.request?.method ?? input.operation,
      requestHeaders: context.ctx.request?.headers ?? new Headers(),
      mutationPayload: input.payload ?? null,
    },
    { userFeatures },
  )
}

export async function runReferenceGuardCallbacks(
  callbacks: Awaited<ReturnType<typeof runReferenceRouteGuards>>['afterSuccessCallbacks'],
  input: MutationGuardAfterInput,
): Promise<void> {
  await Promise.allSettled(callbacks.map(({ guard, metadata }) => guard.afterSuccess?.({ ...input, metadata })))
}

export async function executeReferenceCommand<TResult>(
  context: NonNullable<Awaited<ReturnType<typeof resolveReferenceRouteContext>>>,
  commandId: string,
  input: Record<string, unknown>,
  status = 200,
): Promise<{ result: TResult; response: NextResponse }> {
  const commandBus = context.container.resolve('commandBus') as CommandBus
  const executed = await commandBus.execute<Record<string, unknown>, TResult>(commandId, { input, ctx: context.ctx })
  const response = NextResponse.json(executed.result, { status })
  if (executed.logEntry?.undoToken && executed.logEntry.id && executed.logEntry.commandId) {
    response.headers.set('x-om-operation', serializeOperationMetadata({
      id: executed.logEntry.id,
      undoToken: executed.logEntry.undoToken,
      commandId: executed.logEntry.commandId,
      actionLabel: executed.logEntry.actionLabel ?? null,
      resourceKind: executed.logEntry.resourceKind ?? null,
      resourceId: executed.logEntry.resourceId ?? null,
      executedAt: executed.logEntry.createdAt instanceof Date ? executed.logEntry.createdAt.toISOString() : undefined,
    }))
  }
  return { result: executed.result, response }
}
