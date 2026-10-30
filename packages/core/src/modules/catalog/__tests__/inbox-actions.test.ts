/** @jest-environment node */

const executeCommandMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('../../inbox_ops/lib/executionHelpers', () => ({
  asHelperContext: (ctx: unknown) => ctx,
  ExecutionError: class ExecutionError extends Error {},
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
  resolveProductDiscrepanciesInProposal: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../data/entities', () => ({
  CatalogPriceKind: class CatalogPriceKind {},
}))

import { inboxActions } from '../inbox-actions'
import type { InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function buildContext(): InboxActionExecutionContext {
  return {
    em: {},
    userId: '33333333-3333-4333-8333-333333333333',
    tenantId,
    organizationId,
    container: {},
    executeCommand: jest.fn(),
    resolveEntityClass: () => null,
  }
}

describe('catalog create_product inbox action', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    executeCommandMock.mockImplementation(async (_ctx: unknown, commandId: string) => {
      if (commandId === 'catalog.products.create') return { productId: 'product-1' }
      if (commandId === 'catalog.variants.create') return { variantId: 'variant-1' }
      return { priceId: 'price-1' }
    })
    findOneWithDecryptionMock.mockResolvedValue({ id: 'price-kind-regular', code: 'regular' })
  })

  it('passes the exact unit price string to catalog.prices.create', async () => {
    const action = inboxActions.find((definition) => definition.type === 'create_product')
    expect(action).toBeDefined()
    const unitPrice = '12345678901234.123456789012'

    const result = await action!.execute(
      {
        id: 'action-1',
        proposalId: 'proposal-1',
        payload: { title: 'Precision Widget', unitPrice, currencyCode: 'USD', kind: 'product' },
      },
      buildContext(),
    )

    expect(result).toEqual({ createdEntityId: 'product-1', createdEntityType: 'catalog_product' })
    const priceCall = executeCommandMock.mock.calls.find(([, commandId]) => commandId === 'catalog.prices.create')
    expect(priceCall).toBeDefined()
    expect(priceCall![2]).toEqual(
      expect.objectContaining({
        variantId: 'variant-1',
        productId: 'product-1',
        priceKindId: 'price-kind-regular',
        currencyCode: 'USD',
        unitPriceNet: unitPrice,
      }),
    )
  })
})
