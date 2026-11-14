import type { EntityManager } from '@mikro-orm/postgresql'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { integration, webhookCustomIntegrationId } from '../integration'

export const WEBHOOK_INTEGRATION_DISABLED_MESSAGE = 'Custom Webhooks integration is disabled'

/**
 * `integrations` is an optional peer of `webhooks`: when it is disabled the
 * `IntegrationState` entity is not registered with the ORM, so the marketplace
 * on/off switch cannot be read and the definition default applies instead.
 */
function isIntegrationsModuleEnabled(): boolean {
  return Boolean(getEntityIds(false).integrations?.integration_state)
}

export async function isWebhookIntegrationEnabled(
  em: EntityManager,
  scope: IntegrationScope,
): Promise<boolean> {
  if (!isIntegrationsModuleEnabled()) return integration.defaultState?.isEnabled ?? true
  const stateService = createIntegrationStateService(em)
  return stateService.isEnabled(webhookCustomIntegrationId, scope)
}
