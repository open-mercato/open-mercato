import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { isSudoRequiredError } from '../../lib/sudo-middleware'
import type { MfaAdminService, MfaAdminServiceError } from '../../services/MfaAdminService'
import { localizeSecurityApiBody, securityApiError } from '../i18n'

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
    return securityApiError(401, 'Unauthorized')
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

export async function mapSecurityUsersError(error: unknown): Promise<NextResponse> {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
  }
  if (isSudoRequiredError(error)) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.statusCode })
  }
  if (isMfaAdminServiceError(error)) {
    return securityApiError(error.statusCode, error.message)
  }

  console.error('security.users.route failure', error)
  return securityApiError(500, 'Failed to process user security request.')
}

function isMfaAdminServiceError(error: unknown): error is MfaAdminServiceError {
  return error instanceof Error
    && error.name === 'MfaAdminServiceError'
    && typeof (error as Partial<MfaAdminServiceError>).statusCode === 'number'
}
