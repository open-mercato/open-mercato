import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { executeCallApi } from '../activity-executor'
import { workflowsConfig } from '../../workflows'

/**
 * End-to-end guard for issue #4211: the code-defined checkout demo's
 * `create_order` activity, run through the real interpolation with a realistic
 * cart context, must POST a body carrying a populated `lines` array and the
 * shipping/tax `adjustments` array. The unit test in `__tests__` only checks the
 * static config; this exercises interpolation → the actual fetch body, which is
 * what reaches `/api/sales/orders`.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: any, Entity: any, query: any) => em.findOne(Entity, query)),
  findWithDecryption: jest.fn(async (em: any, Entity: any, query: any, opts: any) => em.find(Entity, query, opts)),
}))

const originalFetch = global.fetch
const mockFetch = jest.fn() as any

beforeEach(() => { global.fetch = mockFetch; mockFetch.mockClear() })
afterEach(() => { global.fetch = originalFetch })

function makeEm() {
  const createdApiKeys: any[] = []
  return {
    create: jest.fn((_E: any, data: any) => { const r = { ...data, id: `k${createdApiKeys.length}` }; createdApiKeys.push(r); return r }),
    persist: jest.fn(function (this: any) { return this }),
    flush: jest.fn(),
    remove: jest.fn(function (this: any) { return this }),
    findOne: jest.fn((E: any, q: any) => {
      const n = E?.name ?? ''
      if (n === 'WorkflowDefinition') return Promise.resolve({ id: 'def-1', tenantId: q.tenantId || 't1', createdBy: 'u1' })
      if (n === 'User') return Promise.resolve({ id: 'u1', tenantId: q.tenantId || 't1', deletedAt: null })
      return Promise.resolve(null)
    }),
    find: jest.fn((E: any, q: any) => {
      const n = E?.name ?? ''
      if (n === 'UserRole') return Promise.resolve([{ id: 'ur1', user: 'u1', role: { id: 'r1' } }])
      if (n === 'Role') return Promise.resolve([{ id: 'r1', name: 'author', tenantId: q.tenantId || 't1' }])
      return Promise.resolve([])
    }),
  } as any
}

describe('checkout-demo create_order request body', () => {
  it('POSTs a populated lines + adjustments array from a realistic cart context', async () => {
    const em = makeEm()
    const container = { resolve: jest.fn((k: string) => (k === 'em' ? em : null)) } as any

    const checkout = workflowsConfig.workflows.find((w) => w.workflowId === 'workflows.checkout-demo')!
    const createOrder = checkout.definition.transitions
      .find((t) => t.transitionId === 'confirmation_to_end')!
      .activities!.find((a) => a.activityId === 'create_order')!

    const context = {
      workflowInstance: {
        id: 'wf1', definitionId: 'def-1', workflowId: 'workflows.checkout-demo',
        tenantId: 't1', organizationId: 'o1', currentStepId: 'order_confirmation', version: 1,
      },
      workflowContext: {
        customer: { id: 'cust-1', name: 'Alco', email: 'a@b.co' },
        cart: {
          id: 'cart-1', currency: 'USD', total: 169.83,
          orderLines: [{ quantity: 1, currencyCode: 'USD', kind: 'product', productId: 'prod-1', name: 'Atlas Runner', unitPriceGross: 148 }],
          orderAdjustments: [
            { kind: 'shipping', label: 'Shipping', currencyCode: 'USD', amountGross: 9.99 },
            { kind: 'tax', label: 'Tax', currencyCode: 'USD', amountGross: 11.84 },
          ],
        },
      },
    }

    mockFetch.mockResolvedValue({
      ok: true, status: 201, statusText: 'Created',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ id: 'order-1', tenantId: 't1' }),
    })

    await executeCallApi(em, createOrder.config, context as any, container)

    const [, options] = mockFetch.mock.calls[0]
    const sentBody = JSON.parse(options.body)

    expect(Array.isArray(sentBody.lines)).toBe(true)
    expect(sentBody.lines).toHaveLength(1)
    expect(sentBody.lines[0].unitPriceGross).toBe(148)
    expect(Array.isArray(sentBody.adjustments)).toBe(true)
    expect(sentBody.adjustments).toHaveLength(2)
  })
})
