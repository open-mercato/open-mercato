import { asValue, createContainer, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'

describe('customer_groups DI wiring', () => {
  test('registers customerGroupsService with a resolveGroups method', () => {
    const container = createContainer<Record<string, unknown>>({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    container.register({
      em: asValue({} as EntityManager),
    })

    register(container)

    const customerGroupsService = container.resolve<{ resolveGroups: unknown }>('customerGroupsService')

    expect(typeof customerGroupsService.resolveGroups).toBe('function')
  })
})
