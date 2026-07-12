import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultOrganizationScopeService } from './services/organizationScopeService'

type OrganizationScopeRbac = ConstructorParameters<typeof DefaultOrganizationScopeService>[1]

export function register(container: AppContainer) {
  container.register({
    organizationScopeService: asFunction((cradle: { em: EntityManager; rbacService: OrganizationScopeRbac }) =>
      new DefaultOrganizationScopeService(cradle.em, cradle.rbacService, container),
    )
      .scoped()
      .proxy(),
  })
}
