import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { MfaAdminService, MfaAdminServiceError } from '../../services/MfaAdminService'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type SecurityUsersRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  mfaAdminService: MfaAdminService
}

export async function resolveSecurityUsersContext(
  req: Request,
): Promise<SecurityUsersRequestContext | NextResponse> {
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
    mfaAdminService: container.resolve<MfaAdminService>('mfaAdminService'),
  }
}

export function mapSecurityUsersError(error: unknown): NextResponse {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(error.body, { status: error.status })
  }
  if (isMfaAdminServiceError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }

  console.error('security.users.route failure', error)
  return NextResponse.json({ error: 'Failed to process user security request.' }, { status: 500 })
}

function isMfaAdminServiceError(error: unknown): error is MfaAdminServiceError {
  return error instanceof Error
    && error.name === 'MfaAdminServiceError'
    && typeof (error as Partial<MfaAdminServiceError>).statusCode === 'number'
}
