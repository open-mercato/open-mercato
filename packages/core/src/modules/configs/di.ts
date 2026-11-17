import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerDateLocaleSettingsResolver,
  registerDateLocaleSettingsScopeResolver,
} from '@open-mercato/shared/lib/date-locale/registry'
import { createModuleConfigService } from './lib/module-config-service'
import {
  resolveDateLocaleSettingsForScopeWithReporting,
  resolveDateLocaleSettingsFromCookies,
} from './lib/date-locale-settings'

// Registered at module scope, like the translations supported-locales resolver: the root layout
// resolves date/locale settings before any request container exists, so a slot filled inside
// `register()` would be empty on the first render of a fresh process.
registerDateLocaleSettingsResolver(resolveDateLocaleSettingsFromCookies)
registerDateLocaleSettingsScopeResolver(resolveDateLocaleSettingsForScopeWithReporting)

export function register(container: AppContainer) {
  const service = createModuleConfigService(container)
  container.register({
    moduleConfigService: asValue(service),
  })
}
