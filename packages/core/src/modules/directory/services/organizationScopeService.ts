import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type {
  OrganizationScopeService,
  OrganizationScopeRequest,
} from '@open-mercato/shared/lib/auth/principal-service'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScope, resolveOrganizationScopeForRequest } from '../utils/organizationScope'

type OrganizationScopeRbac = {
  invalidateUserCache(userId: string): Promise<void>
  loadAcl(
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export class DefaultOrganizationScopeService implements OrganizationScopeService {
  constructor(
    private readonly em: EntityManager,
    private readonly rbac: OrganizationScopeRbac,
    private readonly container: AwilixContainer,
  ) {}

  resolve(input: {
    auth: AuthContext | null | undefined
    selectedId?: string | null
    tenantId?: string | null
    freshAcl?: boolean
  }) {
    const auth = input.auth
    if (input.freshAcl && auth?.sub) {
      return this.resolveFresh({
        auth,
        selectedId: input.selectedId,
        tenantId: input.tenantId,
      }).then((result) => result.scope)
    }
    return resolveOrganizationScope({
      em: this.em,
      rbac: this.rbac as Parameters<typeof resolveOrganizationScope>[0]['rbac'],
      auth: input.auth,
      selectedId: input.selectedId,
      tenantId: input.tenantId,
    })
  }

  async resolveFresh(input: {
    auth: NonNullable<AuthContext>
    selectedId?: string | null
    tenantId?: string | null
  }) {
    await this.rbac.invalidateUserCache(input.auth.sub)
    const acl = await this.rbac.loadAcl(input.auth.sub, {
      tenantId: input.tenantId ?? input.auth.tenantId ?? null,
      organizationId: input.selectedId ?? input.auth.orgId ?? null,
    })
    const freshRbac: Parameters<typeof resolveOrganizationScope>[0]['rbac'] = {
      loadAcl: async () => acl,
    }
    const scope = await resolveOrganizationScope({
      em: this.em,
      rbac: freshRbac,
      auth: input.auth,
      selectedId: input.selectedId,
      tenantId: input.tenantId,
    })
    return { scope, acl }
  }

  resolveForRequest(input: {
    auth: AuthContext | null | undefined
    request?: OrganizationScopeRequest
    selectedId?: string | null
    tenantId?: string | null
  }) {
    return resolveOrganizationScopeForRequest({
      container: this.container,
      auth: input.auth,
      request: input.request,
      selectedId: input.selectedId,
      tenantId: input.tenantId,
    })
  }
}
