import { asClass, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { SsoProviderRegistry } from './lib/registry'
import { OidcProvider } from './lib/oidc-provider'
import { SsoService } from './services/ssoService'
import { AccountLinkingService } from './services/accountLinkingService'

export function register(container: AppContainer) {
  const registry = new SsoProviderRegistry()
  registry.register(new OidcProvider())

  container.register({
    ssoProviderRegistry: asValue(registry),
    ssoService: asClass(SsoService).scoped(),
    accountLinkingService: asClass(AccountLinkingService).scoped(),
  })
}
