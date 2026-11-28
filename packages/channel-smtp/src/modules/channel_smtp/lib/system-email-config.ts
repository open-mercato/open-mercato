import { registerSystemEmailProviderConfigResolver } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { readSmtpEnvPreset } from './preset'

export function registerSmtpSystemEmailConfigResolver(): void {
  registerSystemEmailProviderConfigResolver({
    providerKey: 'smtp',
    isConfigured: () => Boolean(readSmtpEnvPreset()),
    resolveCredentials: ({ fromAddress }) => readSmtpEnvPreset() ?? { fromAddress },
  })
}
