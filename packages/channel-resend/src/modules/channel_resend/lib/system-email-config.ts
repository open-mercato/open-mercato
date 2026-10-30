import { registerSystemEmailProviderConfigResolver } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { readResendEnvPreset } from './preset'

export function registerResendSystemEmailConfigResolver(): void {
  registerSystemEmailProviderConfigResolver({
    providerKey: 'resend',
    isConfigured: () => Boolean(readResendEnvPreset()),
    resolveCredentials: ({ fromAddress }) => readResendEnvPreset() ?? { fromAddress },
  })
}
