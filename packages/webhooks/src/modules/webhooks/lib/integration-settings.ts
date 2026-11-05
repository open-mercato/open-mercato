import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { webhookCustomIntegrationId } from '../integration'

export type WebhookIntegrationSettings = {
  notifyOnFailedDelivery: boolean
}

export async function resolveWebhookIntegrationSettings(
  container: { resolve: <T = unknown>(name: string) => T },
  scope: IntegrationScope,
): Promise<WebhookIntegrationSettings> {
  const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
  const credentials = (await credentialsService.resolve(webhookCustomIntegrationId, scope)) ?? {}

  return {
    notifyOnFailedDelivery: credentials.notifyOnFailedDelivery === true,
  }
}
