// Step 6.3 — thin wiring coverage for `commands/usage.ts`: zod parsing, actor-scope
// resolution from `ctx.auth`/`ctx.selectedOrganizationId`, honoring an ambient
// `ctx.transactionalEm` over forking a fresh one, and delegation to the DI-resolved
// `promotionUsageService`. The actual row-lock/budget-reread/transaction logic is
// `lib/__tests__/promotion-usage-service.test.ts`'s job, not this file's.

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerUsageCommand, revertUsageCommand } from '../usage'

type Call = { method: string; args: unknown[] }

function fakePromotionUsageService() {
  const calls: Call[] = []
  return {
    calls,
    registerUsage: async (...args: unknown[]) => {
      calls.push({ method: 'registerUsage', args })
      return { ok: true as const, budgetExceeded: [] }
    },
    revertUsage: async (...args: unknown[]) => {
      calls.push({ method: 'revertUsage', args })
      return { ok: true as const, revertedCount: 0 }
    },
  }
}

function fakeCtx(options: {
  promotionUsageService: ReturnType<typeof fakePromotionUsageService>
  em?: unknown
  auth?: { tenantId?: string | null; orgId?: string | null } | null
  selectedOrganizationId?: string | null
  transactionalEm?: unknown
}): CommandRuntimeContext {
  const defaultEm: { marker: string; fork: () => unknown } = { marker: 'default-em', fork: () => defaultEm }
  const em = options.em ?? defaultEm
  const container = {
    resolve: (name: string) => {
      if (name === 'promotionUsageService') return options.promotionUsageService
      if (name === 'em') return em
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: (options.auth ?? { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }) as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: options.selectedOrganizationId ?? 'org-1',
    organizationIds: null,
    transactionalEm: options.transactionalEm as CommandRuntimeContext['transactionalEm'],
  }
}

const VALID_PROMOTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('promotions.usage.register command', () => {
  it('parses the raw input, restores ResolvedEffect[] on each appliedPromotion, and delegates to promotionUsageService.registerUsage', async () => {
    const promotionUsageService = fakePromotionUsageService()
    const ctx = fakeCtx({ promotionUsageService })

    const result = await registerUsageCommand.execute(
      {
        orderId: 'order-1',
        orderType: 'order',
        customerId: 'cust-1',
        currency: 'usd',
        appliedPromotions: [
          {
            promotionId: VALID_PROMOTION_ID,
            promotionName: 'Promo',
            effects: [{ type: 'LINE_DISCOUNT', amountNet: '-10.00' }],
          },
        ],
      },
      ctx,
    )

    expect(result).toEqual({ ok: true, budgetExceeded: [] })
    expect(promotionUsageService.calls).toHaveLength(1)
    expect(promotionUsageService.calls[0].method).toBe('registerUsage')
    expect(promotionUsageService.calls[0].args[1]).toEqual({
      orderId: 'order-1',
      orderType: 'order',
      customerId: 'cust-1',
      currency: 'USD',
      appliedPromotions: [
        {
          promotionId: VALID_PROMOTION_ID,
          promotionName: 'Promo',
          effects: [{ type: 'LINE_DISCOUNT', amountNet: '-10.00' }],
        },
      ],
    })
    expect(promotionUsageService.calls[0].args[2]).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('fails closed with a 400 CrudHttpError when the actor carries no tenant/organization scope', async () => {
    const promotionUsageService = fakePromotionUsageService()
    const ctx = fakeCtx({ promotionUsageService, auth: { tenantId: null, orgId: null }, selectedOrganizationId: null })

    expect.assertions(2)
    try {
      await registerUsageCommand.execute(
        {
          orderId: 'order-1',
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [],
        },
        ctx,
      )
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })

  it('reuses ctx.transactionalEm instead of forking a fresh EntityManager when one is already open', async () => {
    const promotionUsageService = fakePromotionUsageService()
    const transactionalEm = { marker: 'ambient' }
    const requestEm = { fork: () => { throw new Error('[internal] must not fork when transactionalEm is set') } }
    const ctx = fakeCtx({ promotionUsageService, em: requestEm, transactionalEm })

    await registerUsageCommand.execute(
      { orderId: 'order-1', orderType: 'order', customerId: null, currency: 'USD', appliedPromotions: [] },
      ctx,
    )

    expect(promotionUsageService.calls[0].args[0]).toBe(transactionalEm)
  })
})

describe('promotions.usage.revert command', () => {
  it('parses the raw input and delegates to promotionUsageService.revertUsage', async () => {
    const promotionUsageService = fakePromotionUsageService()
    const ctx = fakeCtx({ promotionUsageService })

    const result = await revertUsageCommand.execute({ orderId: 'order-1' }, ctx)

    expect(result).toEqual({ ok: true, revertedCount: 0 })
    expect(promotionUsageService.calls[0]).toMatchObject({
      method: 'revertUsage',
      args: [expect.anything(), { orderId: 'order-1' }, { tenantId: 'tenant-1', organizationId: 'org-1' }],
    })
  })
})
