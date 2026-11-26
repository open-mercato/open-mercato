import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { SsoAdminScope } from '../services/ssoConfigService'
import { isBrandedSsoHttpError, type SsoErrorTranslation, type SsoErrorTranslationParams } from '../lib/errors'

export async function resolveSsoAdminContext(req: Request): Promise<{
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  scope: SsoAdminScope
}> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) throw new SsoAdminAuthError('Unauthorized', 401, { key: 'sso.errors.unauthorized' })

  const isSuperAdmin = !!(auth as Record<string, unknown>).isSuperAdmin
  const url = new URL(req.url)

  return {
    auth,
    scope: {
      actorUserId: auth.sub,
      isSuperAdmin,
      organizationId: isSuperAdmin
        ? url.searchParams.get('organizationId') ?? null
        : auth.orgId ?? null,
      tenantId: isSuperAdmin
        ? url.searchParams.get('tenantId') ?? null
        : auth.tenantId ?? null,
    },
  }
}

const SSO_ADMIN_AUTH_ERROR_MARKER = Symbol.for('@open-mercato/sso/SsoAdminAuthError')

export class SsoAdminAuthError extends Error {
  readonly [SSO_ADMIN_AUTH_ERROR_MARKER] = true

  readonly translationKey?: string
  readonly translationParams?: SsoErrorTranslationParams

  constructor(
    message: string,
    public readonly statusCode: number,
    translation?: SsoErrorTranslation,
  ) {
    super(message)
    this.name = 'SsoAdminAuthError'
    this.translationKey = translation?.key
    this.translationParams = translation?.params
  }
}

export function isSsoAdminAuthError(error: unknown): error is SsoAdminAuthError {
  return error instanceof SsoAdminAuthError || isBrandedSsoHttpError(error, SSO_ADMIN_AUTH_ERROR_MARKER, 'SsoAdminAuthError')
}
