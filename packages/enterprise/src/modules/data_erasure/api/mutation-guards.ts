import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { PrivacyApiContext } from './context'

type PrivacyMutationInput = {
  resourceKind: string
  resourceId: string | null
  operation: 'create' | 'update' | 'delete'
  payload: Record<string, unknown>
}

export async function beginPrivacyMutation(
  context: PrivacyApiContext,
  request: Request,
  input: PrivacyMutationInput,
): Promise<{
  blockedResponse: Response | null
  modifiedPayload: Record<string, unknown>
  afterSuccess: (resourceId: string) => Promise<void>
}> {
  const result = await runRouteMutationGuards({
    container: context.container,
    req: request,
    auth: {
      userId: context.actorId,
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
    },
    input: {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      operation: input.operation,
      mutationPayload: input.payload,
    },
  })
  if (!result.ok) {
    return {
      blockedResponse: result.response,
      modifiedPayload: input.payload,
      afterSuccess: async () => undefined,
    }
  }
  return {
    blockedResponse: null,
    modifiedPayload: result.modifiedPayload ?? input.payload,
    afterSuccess: async () => result.runAfterSuccess(),
  }
}
