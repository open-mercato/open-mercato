import cart from '@open-mercato/core/modules/cart/upgrades'
import paymentGateways from '@open-mercato/core/modules/payment_gateways/upgrades'
import promotions from '@open-mercato/core/modules/promotions/upgrades'

const SCHEDULE_ACTIONS = [
  ...cart.map((action) => [action.id, action] as const),
  ...paymentGateways.map((action) => [action.id, action] as const),
  ...promotions.map((action) => [action.id, action] as const),
]

describe('shipped schedule upgrade actions', () => {
  it.each(SCHEDULE_ACTIONS)('%s registers every schedule inside the upgrade transaction', async (_id, action) => {
    const register = jest.fn().mockResolvedValue(undefined)
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: jest.fn(() => ({ register })),
    }
    const em = { marker: 'upgrade-transaction' }
    const deferAfterCommit = jest.fn()

    await action.run({
      container: container as never,
      em: em as never,
      tenantId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      deferAfterCommit,
    })

    expect(register).toHaveBeenCalled()
    for (const call of register.mock.calls) {
      expect(call[1]).toEqual({ em, afterCommit: deferAfterCommit })
    }
  })

  it('covers every shipped schedule action', () => {
    expect(SCHEDULE_ACTIONS.map(([id]) => id).sort()).toEqual([
      'cart.register-sweeper-schedules',
      'payment_gateways.register-session-initialization-prune',
      'promotions.register-code-reservation-sweep-schedule',
    ])
  })
})
