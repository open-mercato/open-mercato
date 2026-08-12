import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyGenericHttpEnvPreset } from './lib/preset'

const logger = createLogger('agent_http')

export const setup: ModuleSetupConfig = {
  /**
   * Configuration permissions only, and no invoke grant.
   * `agent_orchestrator.external_agents.invoke` — the permission that lets a
   * workflow actually reach out — is default-off by design (T2.8) and stays that
   * way: a tenant opts in with `yarn mercato auth sync-role-acls` plus a deliberate
   * grant, and this module must not be the thing that quietly hands it out.
   */
  defaultRoleFeatures: {
    superadmin: ['agent_http.view', 'agent_http.configure'],
    admin: ['agent_http.view', 'agent_http.configure'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyGenericHttpEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationStateService: createIntegrationStateService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      // Never fatal: a tenant must still be created when the deployment's HTTP
      // agent env is half-configured. The operator fixes it and reruns
      // `yarn mercato agent_http configure-from-env`.
      logger.warn('Failed to apply the HTTP agent env preset during tenant setup', { err: error })
    }
  },
}

export default setup
