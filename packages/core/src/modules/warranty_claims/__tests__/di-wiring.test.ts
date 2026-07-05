import { asValue, createContainer, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'

describe('warranty claims DI wiring', () => {
  test('registers v1.3 default seam services', () => {
    const container = createContainer<Record<string, unknown>>({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    container.register({
      em: asValue({} as EntityManager),
    })

    register(container)

    const entitlementResolver = container.resolve<{ resolveEntitlement: unknown }>('warrantyEntitlementResolver')
    const returnLabelProvider = container.resolve<{ createReturnLabel: unknown }>('warrantyReturnLabelProvider')
    const adjudicationEvaluator = container.resolve<{ evaluate: unknown }>('warrantyAdjudicationEvaluator')

    expect(typeof entitlementResolver.resolveEntitlement).toBe('function')
    expect(typeof returnLabelProvider.createReturnLabel).toBe('function')
    expect(typeof adjudicationEvaluator.evaluate).toBe('function')
  })
})
