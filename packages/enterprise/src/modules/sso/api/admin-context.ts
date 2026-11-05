import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { SsoAdminScope } from '../services/ssoConfigService'

export async function resolveSsoAdminContext(req: Request): Promise<{
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  scope: SsoAdminScope
}> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) throw new SsoAdminAuthError('Unauthorized', 401)

  const isSuperAdmin = !!(auth as Record<string, unknown>).isSuperAdmin
  const url = new URL(req.url)

  return {
    auth,
    scope: {
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

export class SsoAdminAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'SsoAdminAuthError'
  }
}
