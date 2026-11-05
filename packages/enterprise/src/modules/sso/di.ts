import { asClass, asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { SsoProviderRegistry } from './lib/registry'
import { OidcProvider } from './lib/oidc-provider'
import { SsoService } from './services/ssoService'
import { AccountLinkingService } from './services/accountLinkingService'
import { SsoConfigService } from './services/ssoConfigService'
import { HrdService } from './services/hrdService'
import { ScimTokenService } from './services/scimTokenService'
import { ScimService } from './services/scimService'
import { SsoAuthService } from './services/ssoAuthService'

export function register(container: AppContainer) {
  const registry = new SsoProviderRegistry()
  registry.register(new OidcProvider())

  container.register({
    authService: asFunction(({ em }: { em: EntityManager }) => new SsoAuthService(em)).scoped().proxy(),
    ssoProviderRegistry: asValue(registry),
    ssoService: asClass(SsoService).scoped(),
    accountLinkingService: asClass(AccountLinkingService).scoped(),
    ssoConfigService: asClass(SsoConfigService).scoped(),
    hrdService: asClass(HrdService).scoped(),
    scimTokenService: asClass(ScimTokenService).scoped(),
    scimService: asClass(ScimService).scoped(),
  })
}
