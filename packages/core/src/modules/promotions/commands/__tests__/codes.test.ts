// Step 6.2 — thin wiring coverage for `commands/codes.ts`: zod parsing, actor-scope
// resolution from `ctx.auth`/`ctx.selectedOrganizationId`, honoring an ambient
// `ctx.transactionalEm` over forking a fresh one, and delegation to the DI-resolved
// `promotionCodeService`. The actual code-resolution/eligibility/locking logic is
// `lib/__tests__/code-service.test.ts`'s job, not this file's.

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { releaseCodeCommand, reserveCodeCommand, revertCodeUseCommand, useCodeCommand } from '../codes'

type Call = { method: string; args: unknown[] }

function fakePromotionCodeService() {
  const calls: Call[] = []
  return {
    calls,
    reserveCode: async (...args: unknown[]) => {
      calls.push({ method: 'reserveCode', args })
      return { ok: true, codeId: 'code-1', type: 'static' as const }
    },
    releaseCode: async (...args: unknown[]) => {
      calls.push({ method: 'releaseCode', args })
    },
    useCode: async (...args: unknown[]) => {
      calls.push({ method: 'useCode', args })
      return { ok: true }
    },
    revertCodeUse: async (...args: unknown[]) => {
      calls.push({ method: 'revertCodeUse', args })
      return { ok: true, revertedCount: 1 }
    },
  }
}

function fakeCtx(options: {
  promotionCodeService: ReturnType<typeof fakePromotionCodeService>
  em?: unknown
  auth?: { tenantId?: string | null; orgId?: string | null } | null
  selectedOrganizationId?: string | null
  transactionalEm?: unknown
}): CommandRuntimeContext {
  const defaultEm: { marker: string; fork: () => unknown } = { marker: 'default-em', fork: () => defaultEm }
  const em = options.em ?? defaultEm
  const container = {
    resolve: (name: string) => {
      if (name === 'promotionCodeService') return options.promotionCodeService
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

describe('promotions.code.reserve command', () => {
  it('parses the raw input and delegates to promotionCodeService.reserveCode with the resolved scope', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const ctx = fakeCtx({ promotionCodeService })

    const result = await reserveCodeCommand.execute(
      { codeString: 'SAVE10', cartId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customerId: 'cust-1' },
      ctx,
    )

    expect(result).toEqual({ ok: true, codeId: 'code-1', type: 'static' })
    expect(promotionCodeService.calls).toHaveLength(1)
    expect(promotionCodeService.calls[0].method).toBe('reserveCode')
    expect(promotionCodeService.calls[0].args[1]).toEqual({
      codeString: 'SAVE10',
      cartId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customerId: 'cust-1',
    })
    expect(promotionCodeService.calls[0].args[2]).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('fails closed with a 400 CrudHttpError when the actor carries no tenant/organization scope', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const ctx = fakeCtx({ promotionCodeService, auth: { tenantId: null, orgId: null }, selectedOrganizationId: null })

    expect.assertions(2)
    try {
      await reserveCodeCommand.execute(
        { codeString: 'SAVE10', cartId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customerId: null },
        ctx,
      )
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })

  it('reuses ctx.transactionalEm instead of forking a fresh EntityManager when one is already open', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const transactionalEm = { marker: 'ambient' }
    const requestEm = { fork: () => { throw new Error('[internal] must not fork when transactionalEm is set') } }
    const ctx = fakeCtx({ promotionCodeService, em: requestEm, transactionalEm })

    await reserveCodeCommand.execute(
      { codeString: 'SAVE10', cartId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customerId: null },
      ctx,
    )

    expect(promotionCodeService.calls[0].args[0]).toBe(transactionalEm)
  })
})

describe('promotions.code.release command', () => {
  it('delegates to promotionCodeService.releaseCode and always returns { ok: true }', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const ctx = fakeCtx({ promotionCodeService })

    const result = await releaseCodeCommand.execute(
      { codeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cartId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx,
    )

    expect(result).toEqual({ ok: true })
    expect(promotionCodeService.calls[0]).toMatchObject({
      method: 'releaseCode',
      args: [
        expect.anything(),
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      ],
    })
  })
})

describe('promotions.code.use command', () => {
  it('parses the raw input and delegates to promotionCodeService.useCode', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const ctx = fakeCtx({ promotionCodeService })

    const result = await useCodeCommand.execute(
      {
        codeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        codeString: 'SAVE10',
        cartId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customerId: 'cust-1',
        type: 'static',
      },
      ctx,
    )

    expect(result).toEqual({ ok: true })
    expect(promotionCodeService.calls[0].method).toBe('useCode')
  })
})

describe('promotions.code.use.revert command', () => {
  it('parses the raw input and delegates to promotionCodeService.revertCodeUse with the resolved scope', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const ctx = fakeCtx({ promotionCodeService })

    const result = await revertCodeUseCommand.execute({ orderId: 'order-1' }, ctx)

    expect(result).toEqual({ ok: true, revertedCount: 1 })
    expect(promotionCodeService.calls[0].method).toBe('revertCodeUse')
    expect(promotionCodeService.calls[0].args[1]).toEqual({ orderId: 'order-1' })
    expect(promotionCodeService.calls[0].args[2]).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('fails closed with a 400 CrudHttpError when the actor carries no tenant/organization scope', async () => {
    const promotionCodeService = fakePromotionCodeService()
    const ctx = fakeCtx({ promotionCodeService, auth: { tenantId: null, orgId: null }, selectedOrganizationId: null })

    expect.assertions(2)
    try {
      await revertCodeUseCommand.execute({ orderId: 'order-1' }, ctx)
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(400)
    }
  })
})
