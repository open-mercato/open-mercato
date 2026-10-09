import { registerSystemEmailProviderConfigResolver } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { readMailjetEnvPreset } from './preset'

export function registerMailjetSystemEmailConfigResolver(): void {
  registerSystemEmailProviderConfigResolver({
    providerKey: 'mailjet',
    isConfigured: () => Boolean(readMailjetEnvPreset()),
    resolveCredentials: ({ fromAddress }) => readMailjetEnvPreset() ?? { fromAddress },
  })
}
