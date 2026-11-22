import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { mapInspectionToHealth, OAUTH_HEALTH_CODES } from '@open-mercato/core/modules/integrations/lib/oauth/health'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { createXeroDescriptor } from './descriptor'
import { resolveXeroEndpoints, XeroTestFakesUnavailableError } from './endpoints'
import { buildXeroGrantOwner } from './owner'

export type XeroHealthResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  details: { code: string }
}

export type XeroHealthCheckDeps = {
  credentialsService: CredentialsService
  grantService: IntegrationOAuthGrantService
}

/**
 * Network-free (core R10): the core's mapping of `inspectGrant`, where every unhealthy or degraded
 * core code wins, and a connected grant without a chosen Organisation is `degraded`
 * `xero.account_pending`. Registered scoped, so the health service resolves it in the caller's
 * request container. `details` never carries a token.
 */
export function createXeroHealthCheck({ credentialsService, grantService }: XeroHealthCheckDeps) {
  return {
    async check(_credentials: Record<string, unknown> | null, scope: IntegrationScope): Promise<XeroHealthResult> {
      const ownerScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
      let endpoints
      try {
        endpoints = await resolveXeroEndpoints({ scope: ownerScope, credentialsService })
      } catch (error) {
        if (error instanceof XeroTestFakesUnavailableError) return { status: 'unhealthy', details: { code: error.code } }
        throw error
      }
      const inspection = await grantService.inspectGrant(createXeroDescriptor(endpoints), buildXeroGrantOwner(ownerScope))
      const health = mapInspectionToHealth(inspection)
      const accountPending = (inspection.status === 'active' || inspection.status === 'invalidated') && !inspection.hasExternalAccount
      if (health.details.code === OAUTH_HEALTH_CODES.connected && accountPending) {
        return { status: 'degraded', details: { code: 'xero.account_pending' } }
      }
      return health
    },
  }
}
