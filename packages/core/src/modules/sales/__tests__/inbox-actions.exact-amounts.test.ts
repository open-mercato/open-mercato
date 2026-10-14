/** @jest-environment node */

import type { InboxActionDefinition, InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import { inboxActions } from '../inbox-actions'

jest.mock('../../inbox_ops/lib/executionHelpers', () => ({
  ...jest.requireActual('../../inbox_ops/lib/executionHelpers'),
  resolveEffectiveDocumentKind: jest.fn(async () => 'order'),
}))

const CHANNEL_ID = '123e4567-e89b-4d56-a456-426614174000'
const LONG_PRICE = '1234567890.123456789012345'

function findAction(type: 'create_order' | 'create_quote'): InboxActionDefinition {
  const action = inboxActions.find((entry) => entry.type === type)
  if (!action) throw new Error(`[internal] missing inbox action ${type}`)
  return action
}

function buildContext(commandResult: Record<string, unknown>) {
  const execute = jest.fn<Promise<{ result: Record<string, unknown> }>, [string, unknown]>(
    async () => ({ result: commandResult }),
  )
  const ctx = {
    em: {},
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    container: {
      resolve: (token: string) => (token === 'commandBus' ? { execute } : null),
    },
    executeCommand: jest.fn(),
    resolveEntityClass: jest.fn(() => null),
  } as unknown as InboxActionExecutionContext
  return { ctx, execute }
}

function buildPayload(unitPrice: string) {
  return {
    customerName: 'Test Customer',
    channelId: CHANNEL_ID,
    currencyCode: 'EUR',
    lineItems: [{ productName: 'Widget', quantity: '2', unitPrice }],
  }
}

function firstLine(execute: jest.Mock): Record<string, unknown> | undefined {
  const [, options] = execute.mock.calls[0] as [string, { input: { lines: Array<Record<string, unknown>> } }]
  return options.input.lines[0]
}

describe('sales inbox actions keep exact unit prices', () => {
  it('passes the original unit price string to sales.orders.create', async () => {
    const { ctx, execute } = buildContext({ orderId: 'order-1' })

    await findAction('create_order').execute(
      { id: 'action-1', proposalId: 'proposal-1', payload: buildPayload(LONG_PRICE) },
      ctx,
    )

    expect(execute.mock.calls[0]?.[0]).toBe('sales.orders.create')
    expect(firstLine(execute)?.unitPriceNet).toBe(LONG_PRICE)
    expect(firstLine(execute)?.quantity).toBe(2)
  })

  it('passes the original unit price string to sales.quotes.create', async () => {
    const { ctx, execute } = buildContext({ quoteId: 'quote-1' })

    await findAction('create_quote').execute(
      { id: 'action-1', proposalId: 'proposal-1', payload: buildPayload(LONG_PRICE) },
      ctx,
    )

    expect(execute.mock.calls[0]?.[0]).toBe('sales.quotes.create')
    expect(firstLine(execute)?.unitPriceNet).toBe(LONG_PRICE)
  })

  it('still rejects a non-numeric unit price before calling the command', async () => {
    const { ctx, execute } = buildContext({ quoteId: 'quote-1' })

    await expect(
      findAction('create_quote').execute(
        { id: 'action-1', proposalId: 'proposal-1', payload: buildPayload('not-a-number') },
        ctx,
      ),
    ).rejects.toThrow('Invalid numeric value for lineItems[0].unitPrice')
    expect(execute).not.toHaveBeenCalled()
  })
})
