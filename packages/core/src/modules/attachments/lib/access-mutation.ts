import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { throwAttachmentAccessError } from './access-errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

export async function prepareAttachmentMutation(input: {
  container: AwilixContainer
  req: Request
  auth: NonNullable<AuthContext>
  recordId?: string
  operation: 'update' | 'delete'
  payload?: Record<string, unknown>
}) {
  if (!input.auth.tenantId) return throwAttachmentAccessError(401)
  const guard = await runRouteMutationGuards({
    container: input.container, req: input.req,
    auth: { tenantId: input.auth.tenantId, organizationId: input.auth.orgId ?? null, userId: input.auth.sub },
    input: {
      resourceKind: 'attachments:attachment', resourceId: input.recordId,
      operation: input.operation, mutationPayload: input.payload,
    },
  })
  if (!guard.ok) throw new CrudHttpError(guard.errorStatus, guard.errorBody)
  return guard
}
