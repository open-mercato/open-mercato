/**
 * @jest-environment node
 */
import { createContainer, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import { BaseCurrencyService } from '../services/baseCurrencyService'

type BaseCurrencyServiceFactory = (em: EntityManager) => BaseCurrencyService

describe('currencies DI registration', () => {
  test('baseCurrencyServiceFactory binds the service to the entity manager it is given', async () => {
    const containerExecute = jest.fn(async () => [])
    const callerExecute = jest.fn(async () => [{ organization_id: 'org-1', code: 'PLN' }])
    const container = createContainer({ injectionMode: InjectionMode.PROXY }) as unknown as AppContainer
    container.register({ em: { resolve: () => ({ execute: containerExecute, getTransactionContext: () => undefined }) } } as Parameters<AppContainer['register']>[0])
    register(container)

    const factory = container.resolve<BaseCurrencyServiceFactory>('baseCurrencyServiceFactory')
    const service = factory({ execute: callerExecute, getTransactionContext: () => undefined } as unknown as EntityManager)

    expect(service).toBeInstanceOf(BaseCurrencyService)
    await expect(service.resolveBaseCurrency({ tenantId: 'tenant-1', organizationIds: ['org-1'] }))
      .resolves.toEqual({ status: 'resolved', code: 'PLN' })
    expect(callerExecute).toHaveBeenCalledTimes(1)
    expect(containerExecute).not.toHaveBeenCalled()
  })
})
