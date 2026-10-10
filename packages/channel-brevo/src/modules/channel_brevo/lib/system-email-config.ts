import { registerSystemEmailProviderConfigResolver } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { readBrevoEnvPreset } from './preset'

export function registerBrevoSystemEmailConfigResolver(): void {
  registerSystemEmailProviderConfigResolver({
    providerKey: 'brevo',
    isConfigured: () => Boolean(readBrevoEnvPreset()),
    resolveCredentials: ({ fromAddress }) => readBrevoEnvPreset() ?? { fromAddress },
  })
}
