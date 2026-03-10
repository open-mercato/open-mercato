import { NextResponse } from 'next/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { MfaEnforcementPolicy } from '../../data/entities'
import type { MfaEnforcementServiceError, MfaEnforcementService } from '../../services/MfaEnforcementService'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type EnforcementRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  enforcementService: MfaEnforcementService
}

export async function resolveEnforcementContext(req: Request): Promise<EnforcementRequestContext | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  return {
    auth,
    container,
    commandContext: {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: auth.orgId ? [auth.orgId] : null,
      request: req,
    },
    enforcementService: container.resolve<MfaEnforcementService>('mfaEnforcementService'),
  }
}

export function mapEnforcementError(error: unknown): NextResponse {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(error.body, { status: error.status })
  }
  if (isMfaEnforcementServiceError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('security.enforcement.route failure', error)
  return NextResponse.json({ error: 'Failed to process enforcement request.' }, { status: 500 })
}

export function toPolicyResponse(policy: MfaEnforcementPolicy): {
  id: string
  scope: string
  tenantId: string | null
  organizationId: string | null
  isEnforced: boolean
  allowedMethods: string[] | null
  enforcementDeadline: string | null
  enforcedBy: string
  createdAt: string
  updatedAt: string
} {
  return {
    id: policy.id,
    scope: policy.scope,
    tenantId: policy.tenantId ?? null,
    organizationId: policy.organizationId ?? null,
    isEnforced: policy.isEnforced,
    allowedMethods: policy.allowedMethods ?? null,
    enforcementDeadline: policy.enforcementDeadline ? policy.enforcementDeadline.toISOString() : null,
    enforcedBy: policy.enforcedBy,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  }
}

function isMfaEnforcementServiceError(error: unknown): error is MfaEnforcementServiceError {
  return error instanceof Error
    && error.name === 'MfaEnforcementServiceError'
    && typeof (error as Partial<MfaEnforcementServiceError>).statusCode === 'number'
}
