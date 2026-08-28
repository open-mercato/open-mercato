import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type StaffClaims = {
  sub: string
  tenantId: string | null
  orgId: string | null
  roles: string[]
}

type SsoConfigServiceLike = {
  isSsoRequiredForOrganization: (tenantId: string | null, organizationId: string) => Promise<boolean>
}

function readStaffClaims(token: string): StaffClaims | null {
  const payload = verifyJwt(token)
  if (!payload || typeof payload !== 'object' || typeof payload.sub !== 'string') return null

  return {
    sub: payload.sub,
    tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
    orgId: typeof payload.orgId === 'string' ? payload.orgId : null,
    roles: Array.isArray(payload.roles)
      ? payload.roles.filter((value: unknown): value is string => typeof value === 'string')
      : [],
  }
}

function resolveSsoConfigService(container: { resolve: (name: string) => unknown }): SsoConfigServiceLike {
  const service = container.resolve('ssoConfigService')
  if (
    !service
    || typeof service !== 'object'
    || typeof (service as { isSsoRequiredForOrganization?: unknown }).isSsoRequiredForOrganization !== 'function'
  ) {
    throw new Error('[internal] SSO configuration service is unavailable during login')
  }
  return service as SsoConfigServiceLike
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'sso.auth.login.required',
    targetRoute: 'auth/login',
    methods: ['POST'],
    priority: 100,
    async after(_request, response, context) {
      if (response.statusCode !== 200 || response.body.ok !== true) return {}
      if (typeof response.body.token !== 'string' || response.body.token.length === 0) return {}

      const claims = readStaffClaims(response.body.token)
      if (!claims) throw new Error('[internal] Password login returned an invalid staff token')

      const isSuperAdmin = await resolveIsSuperAdmin({
        auth: claims,
        container: context.container,
      })
      if (isSuperAdmin) return {}
      if (!claims.orgId) throw new Error('[internal] Password login token is missing organization context')

      const service = resolveSsoConfigService(context.container)
      if (!(await service.isSsoRequiredForOrganization(claims.tenantId, claims.orgId))) return {}

      const { translate } = await resolveTranslations()
      return {
        replace: {
          ok: false,
          code: 'SSO_REQUIRED',
          error: translate(
            'sso.login.errors.ssoRequired',
            'Password login is disabled for this organization. Continue with SSO.',
          ),
        },
      }
    },
  },
]
