import { registerSystemEmailProviderConfigResolver } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { readSesEnvPreset } from './preset'

export function registerSesSystemEmailConfigResolver(): void {
  registerSystemEmailProviderConfigResolver({
    providerKey: 'ses',
    isConfigured: () => Boolean(readSesEnvPreset()),
    resolveCredentials: ({ fromAddress }) => readSesEnvPreset() ?? { fromAddress },
  })
}
