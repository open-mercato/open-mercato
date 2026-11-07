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

  test('registers customerCreditService with its own methods, not grown onto customerGroupsService (G26)', () => {
    const container = createContainer<Record<string, unknown>>({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    container.register({
      em: asValue({} as EntityManager),
    })

    register(container)

    const customerCreditService = container.resolve<{
      checkCredit: unknown
      reserveCredit: unknown
      releaseCredit: unknown
      settleCredit: unknown
    }>('customerCreditService')
    const customerGroupsService = container.resolve<Record<string, unknown>>('customerGroupsService')

    expect(typeof customerCreditService.checkCredit).toBe('function')
    expect(typeof customerCreditService.reserveCredit).toBe('function')
    expect(typeof customerCreditService.releaseCredit).toBe('function')
    expect(typeof customerCreditService.settleCredit).toBe('function')
    expect(customerGroupsService.checkCredit).toBeUndefined()
    expect(customerGroupsService.reserveCredit).toBeUndefined()
  })

  test('registers customerPurchaseApprovalService with its own methods, not grown onto customerGroupsService or customerCreditService (G26)', () => {
    const container = createContainer<Record<string, unknown>>({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    container.register({
      em: asValue({} as EntityManager),
    })

    register(container)

    const approvalService = container.resolve<{
      requestApproval: unknown
      getApproval: unknown
      getActiveApprovalForSubject: unknown
      withdrawApproval: unknown
      decideApproval: unknown
    }>('customerPurchaseApprovalService')
    const customerGroupsService = container.resolve<Record<string, unknown>>('customerGroupsService')
    const customerCreditService = container.resolve<Record<string, unknown>>('customerCreditService')

    expect(typeof approvalService.requestApproval).toBe('function')
    expect(typeof approvalService.getApproval).toBe('function')
    expect(typeof approvalService.getActiveApprovalForSubject).toBe('function')
    expect(typeof approvalService.withdrawApproval).toBe('function')
    expect(typeof approvalService.decideApproval).toBe('function')
    expect(customerGroupsService.requestApproval).toBeUndefined()
    expect(customerCreditService.requestApproval).toBeUndefined()
  })

  test('boots customerPurchaseApprovalService without moduleConfigService registered (optional peer, D-R5-27 default)', () => {
    const container = createContainer<Record<string, unknown>>({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    container.register({
      em: asValue({} as EntityManager),
    })

    register(container)

    const approvalService = container.resolve<{ requestApproval: unknown }>('customerPurchaseApprovalService')
    expect(typeof approvalService.requestApproval).toBe('function')
  })
})
