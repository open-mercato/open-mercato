/** @jest-environment node */

import {
  executeAction,
  rejectAction,
  rejectProposal,
  recalculateProposalStatus,
  acceptAllActions,
  getRequiredFeature,
} from '../executionEngine'
import type { InboxProposalAction } from '../../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@/.mercato/generated/inbox-actions.generated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sales = require('@open-mercato/core/modules/sales/inbox-actions')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const customers = require('@open-mercato/core/modules/customers/inbox-actions')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const catalog = require('@open-mercato/core/modules/catalog/inbox-actions')
  const allActions = [
    ...(sales.default ?? sales.inboxActions ?? []),
    ...(customers.default ?? customers.inboxActions ?? []),
    ...(catalog.default ?? catalog.inboxActions ?? []),
  ]
  const actionTypeMap = new Map(allActions.map((a: { type: string }) => [a.type, a]))
  return {
    inboxActions: allActions,
    getInboxAction: (type: string) => actionTypeMap.get(type),
    getRegisteredActionTypes: () => Array.from(actionTypeMap.keys()),
  }
})

function createMockEm() {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    nativeUpdate: jest.fn(),
    flush: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.flush.mockResolvedValue(undefined)
  return em
}

const mockRbacService = {
  userHasAllFeatures: jest.fn(),
}

const mockCommandBus = {
  execute: jest.fn(),
}

const mockEventBus = {
  emit: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return mockRbacService
    if (token === 'commandBus') return mockCommandBus
    return null
  }),
}

const MockCustomerEntity = class {} as unknown
const MockSalesOrder = class {} as unknown
const MockSalesShipment = class {} as unknown
const MockSalesChannel = class {} as unknown
const MockDictionary = class {} as unknown
const MockDictionaryEntry = class {} as unknown

function makeCtx(em: ReturnType<typeof createMockEm>, overrides?: Record<string, unknown>) {
  return {
    em,
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    eventBus: mockEventBus,
    container: mockContainer,
    entities: {
      CustomerEntity: MockCustomerEntity,
      SalesOrder: MockSalesOrder,
      SalesShipment: MockSalesShipment,
      SalesChannel: MockSalesChannel,
      Dictionary: MockDictionary,
      DictionaryEntry: MockDictionaryEntry,
    },
    ...overrides,
  } as any
}

const VALID_UUID = '123e4567-e89b-4d56-a456-426614174000'
const VALID_UUID_2 = '123e4567-e89b-4d56-a456-426614174001'

function makeAction(overrides?: Partial<InboxProposalAction>): InboxProposalAction {
  return {
    id: 'action-1',
    proposalId: 'proposal-1',
    actionType: 'create_order',
    status: 'pending',
    payload: {
      customerName: 'Test Customer',
      channelId: VALID_UUID,
      currencyCode: 'EUR',
      lineItems: [{ productName: 'Widget', quantity: '10' }],
    },
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  } as unknown as InboxProposalAction
}

describe('executionEngine', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockRbacService.userHasAllFeatures.mockResolvedValue(true)
    mockEventBus.emit.mockResolvedValue(undefined)
    mockCommandBus.execute.mockResolvedValue({ result: {} })
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'rbacService') return mockRbacService
      if (token === 'commandBus') return mockCommandBus
      return null
    })
  })

  describe('executeAction', () => {
    it('returns 403 when user lacks required feature', async () => {
      mockRbacService.userHasAllFeatures.mockResolvedValue(false)
      const em = createMockEm()
      const action = makeAction()

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(403)
      expect(result.error).toContain('Insufficient permissions')
      expect(em.nativeUpdate).not.toHaveBeenCalled()
    })

    it('returns 409 when optimistic lock fails (action already processed)', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(0)
      const action = makeAction()

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(409)
      expect(result.error).toContain('already processed')
    })

    it('executes action successfully and creates entity', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({ status: 'processing' })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-1' } })

      const action = makeAction()
      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('order-1')
      expect(result.createdEntityType).toBe('sales_order')
      expect(freshAction.status).toBe('executed')
      expect(freshAction.executedByUserId).toBe('user-1')
      expect(freshAction.createdEntityId).toBe('order-1')
    })

    it('marks action as failed and emits failure event on error', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({ status: 'processing' })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      mockCommandBus.execute.mockRejectedValue(new Error('Command failed'))

      const action = makeAction()
      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.error).toBe('Command failed')
      expect(freshAction.status).toBe('failed')
      expect(freshAction.executionError).toBe('Command failed')
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'inbox_ops.action.failed',
        expect.objectContaining({ actionId: freshAction.id }),
      )
    })

    it('emits action.executed event on success', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({ status: 'processing' })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-1' } })

      const action = makeAction()
      await executeAction(action, makeCtx(em))

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'inbox_ops.action.executed',
        expect.objectContaining({
          actionId: freshAction.id,
          actionType: 'create_order',
          createdEntityId: 'order-1',
          createdEntityType: 'sales_order',
        }),
      )
    })
  })

  describe('rejectAction', () => {
    it('rejects and recalculates proposal status', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const action = makeAction()
      mockFindOneWithDecryption.mockResolvedValueOnce(action)

      await rejectAction(action, makeCtx(em))

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'action-1', status: { $in: ['pending', 'failed'] } }),
        expect.objectContaining({ status: 'rejected' }),
      )
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'inbox_ops.action.rejected',
        expect.objectContaining({ actionId: 'action-1' }),
      )
    })

    it('is a no-op when action was already processed (claimed=0)', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(0)
      const action = makeAction({ status: 'executed' } as any)

      await rejectAction(action, makeCtx(em))

      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
      expect(mockEventBus.emit).not.toHaveBeenCalled()
    })
  })

  describe('rejectProposal', () => {
    it('bulk rejects all pending actions and resolves discrepancies', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      await rejectProposal('proposal-1', makeCtx(em))

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ proposalId: 'proposal-1', status: { $in: ['pending', 'failed'] } }),
        expect.objectContaining({ status: 'rejected' }),
      )
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ proposalId: 'proposal-1', resolved: false }),
        { resolved: true },
      )
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'inbox_ops.proposal.rejected',
        expect.objectContaining({ proposalId: 'proposal-1' }),
      )
    })
  })

  describe('recalculateProposalStatus', () => {
    it('sets status to accepted when all actions are accepted/executed', async () => {
      const em = createMockEm()
      const proposal = { id: 'p-1', status: 'pending' }
      mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
      mockFindWithDecryption.mockResolvedValueOnce([
        { status: 'executed' },
        { status: 'accepted' },
      ])

      await recalculateProposalStatus(em as any, 'p-1')

      expect(proposal.status).toBe('accepted')
      expect(em.flush).toHaveBeenCalled()
    })

    it('sets status to rejected when all actions are rejected', async () => {
      const em = createMockEm()
      const proposal = { id: 'p-1', status: 'pending' }
      mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
      mockFindWithDecryption.mockResolvedValueOnce([
        { status: 'rejected' },
        { status: 'rejected' },
      ])

      await recalculateProposalStatus(em as any, 'p-1')

      expect(proposal.status).toBe('rejected')
    })

    it('sets status to partial when actions have mixed statuses', async () => {
      const em = createMockEm()
      const proposal = { id: 'p-1', status: 'pending' }
      mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
      mockFindWithDecryption.mockResolvedValueOnce([
        { status: 'executed' },
        { status: 'pending' },
      ])

      await recalculateProposalStatus(em as any, 'p-1')

      expect(proposal.status).toBe('partial')
    })

    it('keeps status as pending when all actions are pending', async () => {
      const em = createMockEm()
      const proposal = { id: 'p-1', status: 'pending' }
      mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
      mockFindWithDecryption.mockResolvedValueOnce([
        { status: 'pending' },
        { status: 'pending' },
      ])

      await recalculateProposalStatus(em as any, 'p-1')

      expect(proposal.status).toBe('pending')
      expect(em.flush).toHaveBeenCalledTimes(0)
    })

    it('sets status to pending when no actions exist', async () => {
      const em = createMockEm()
      const proposal = { id: 'p-1', status: 'partial' }
      mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
      mockFindWithDecryption.mockResolvedValueOnce([])

      await recalculateProposalStatus(em as any, 'p-1')

      expect(proposal.status).toBe('pending')
      expect(em.flush).toHaveBeenCalled()
    })
  })

  describe('acceptAllActions', () => {
    it('executes actions in sort order and stops on first failure', async () => {
      const em = createMockEm()
      const action1 = makeAction({ id: 'a-1', sortOrder: 0 } as any)
      const action2 = makeAction({ id: 'a-2', sortOrder: 1 } as any)

      mockFindWithDecryption.mockResolvedValueOnce([action1, action2])

      // First executeAction: succeeds
      em.nativeUpdate.mockResolvedValueOnce(1)
      const freshAction1 = makeAction({ id: 'a-1', status: 'processing' })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction1)
      mockCommandBus.execute.mockResolvedValueOnce({ result: { orderId: 'o-1' } })

      // Second executeAction: claim fails
      em.nativeUpdate.mockResolvedValueOnce(0)

      const { results, stoppedOnFailure } = await acceptAllActions('proposal-1', makeCtx(em))

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(stoppedOnFailure).toBe(true)
    })

    it('returns empty results when no pending actions', async () => {
      const em = createMockEm()
      mockFindWithDecryption.mockResolvedValueOnce([])

      const { results, stoppedOnFailure } = await acceptAllActions('proposal-1', makeCtx(em))

      expect(results).toHaveLength(0)
      expect(stoppedOnFailure).toBe(false)
    })
  })

  describe('executeAction — create_contact dedup', () => {
    it('returns existing contact instead of creating duplicate when email matches', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-contact',
        actionType: 'create_contact',
        status: 'processing',
        payload: {
          type: 'person',
          name: 'Jane Doe',
          email: 'jane@example.com',
          source: 'inbox_ops',
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({
          id: 'existing-contact-1',
          entityType: 'person',
          primaryEmail: 'jane@example.com',
        })

      const action = makeAction({
        id: 'a-contact',
        actionType: 'create_contact',
        payload: {
          type: 'person',
          name: 'Jane Doe',
          email: 'jane@example.com',
          source: 'inbox_ops',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('existing-contact-1')
      expect(mockCommandBus.execute).not.toHaveBeenCalled()
    })
  })

  describe('executeAction — draft_reply no contact', () => {
    it('fails with clear error when no contact found for draft reply', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-reply',
        actionType: 'draft_reply',
        status: 'processing',
        payload: {
          to: 'unknown@example.com',
          subject: 'Re: Order',
          body: 'Thank you for your order.',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-reply',
        actionType: 'draft_reply',
        payload: {
          to: 'unknown@example.com',
          subject: 'Re: Order',
          body: 'Thank you for your order.',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.error).toContain('No matching contact found')
      expect(result.error).toContain('unknown@example.com')
    })
  })

  describe('acceptAllActions — partial failure', () => {
    it('stops on failure and leaves remaining actions as pending', async () => {
      const em = createMockEm()

      const action1 = makeAction({ id: 'a-1', sortOrder: 0 })
      const action2 = makeAction({ id: 'a-2', sortOrder: 1 })
      const action3 = makeAction({ id: 'a-3', sortOrder: 2 })

      mockFindWithDecryption.mockResolvedValueOnce([action1, action2, action3])

      // Action 1: succeeds
      em.nativeUpdate.mockResolvedValueOnce(1)
      const fresh1 = makeAction({ id: 'a-1', status: 'processing' })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(fresh1)   // fresh action 1
        .mockResolvedValueOnce(null)     // SalesChannel lookup (resolveEffectiveDocumentKind)
        .mockResolvedValueOnce(null)     // recalculateProposalStatus proposal (after action 1)
      mockCommandBus.execute.mockResolvedValueOnce({ result: { orderId: 'o-1' } })

      // Action 2: fails execution
      em.nativeUpdate.mockResolvedValueOnce(1)
      const fresh2 = makeAction({ id: 'a-2', status: 'processing' })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(fresh2)   // fresh action 2
        .mockResolvedValueOnce(null)     // SalesChannel lookup (resolveEffectiveDocumentKind)
      mockCommandBus.execute.mockRejectedValueOnce(new Error('Inventory unavailable'))

      const { results, stoppedOnFailure } = await acceptAllActions('proposal-1', makeCtx(em))

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].createdEntityId).toBe('o-1')
      expect(results[1].success).toBe(false)
      expect(results[1].error).toBe('Inventory unavailable')
      expect(stoppedOnFailure).toBe(true)
      // Action 3 was never attempted
      expect(fresh1.status).toBe('executed')
      expect(fresh2.status).toBe('failed')
    })
  })

  describe('executeAction — create_quote', () => {
    it('creates a quote via sales.quotes.create command', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-quote',
        actionType: 'create_quote',
        status: 'processing',
        payload: {
          customerName: 'Acme Corp',
          channelId: VALID_UUID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Service A', quantity: '5', kind: 'service' }],
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      mockCommandBus.execute.mockResolvedValue({ result: { quoteId: 'quote-1' } })

      const action = makeAction({
        id: 'a-quote',
        actionType: 'create_quote',
        payload: {
          customerName: 'Acme Corp',
          channelId: VALID_UUID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Service A', quantity: '5', kind: 'service' }],
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('quote-1')
      expect(result.createdEntityType).toBe('sales_quote')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.quotes.create',
        expect.objectContaining({
          input: expect.objectContaining({ currencyCode: 'EUR' }),
        }),
      )
    })
  })

  describe('executeAction — create_order auto-switches to quote when channel requires it', () => {
    it('creates a quote instead of order when channel metadata.quotesRequired is true', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-order-switch',
        actionType: 'create_order',
        status: 'processing',
        payload: {
          customerName: 'Acme Corp',
          channelId: VALID_UUID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({ id: VALID_UUID, name: 'Web', metadata: { quotesRequired: true } })

      mockCommandBus.execute.mockResolvedValue({ result: { quoteId: 'quote-auto-1' } })

      const action = makeAction({
        id: 'a-order-switch',
        actionType: 'create_order',
        payload: {
          customerName: 'Acme Corp',
          channelId: VALID_UUID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('quote-auto-1')
      expect(result.createdEntityType).toBe('sales_quote')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.quotes.create',
        expect.anything(),
      )
    })

    it('creates an order normally when channel metadata.quotesRequired is absent', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-order-normal',
        status: 'processing',
        payload: {
          customerName: 'Acme Corp',
          channelId: VALID_UUID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({ id: VALID_UUID, name: 'Web', metadata: {} })

      mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-normal-1' } })

      const action = makeAction({
        id: 'a-order-normal',
        payload: {
          customerName: 'Acme Corp',
          channelId: VALID_UUID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('order-normal-1')
      expect(result.createdEntityType).toBe('sales_order')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.orders.create',
        expect.anything(),
      )
    })
  })

  describe('executeAction — update_order', () => {
    it('updates order delivery date and notes via command', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-update',
        actionType: 'update_order',
        status: 'processing',
        payload: {
          orderId: VALID_UUID,
          deliveryDateChange: { newDate: '2026-03-15' },
          noteAdditions: ['Updated per client request'],
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({
          id: VALID_UUID,
          orderNumber: 'ORD-001',
          currencyCode: 'EUR',
          comments: 'Existing note',
        })

      mockCommandBus.execute.mockResolvedValue({ result: { orderId: VALID_UUID } })

      const action = makeAction({
        id: 'a-update',
        actionType: 'update_order',
        payload: {
          orderId: VALID_UUID,
          deliveryDateChange: { newDate: '2026-03-15' },
          noteAdditions: ['Updated per client request'],
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe(VALID_UUID)
      expect(result.createdEntityType).toBe('sales_order')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.orders.update',
        expect.objectContaining({
          input: expect.objectContaining({
            id: VALID_UUID,
            comments: expect.stringContaining('Updated per client request'),
          }),
        }),
      )
    })
  })

  describe('executeAction — update_shipment', () => {
    it('updates shipment status via dictionary lookup and command', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-ship',
        actionType: 'update_shipment',
        status: 'processing',
        payload: {
          orderId: VALID_UUID,
          statusLabel: 'Shipped',
          trackingNumbers: ['TRACK-123'],
          carrierName: 'DHL',
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({ id: VALID_UUID, orderNumber: 'ORD-001', currencyCode: 'EUR' })
        .mockResolvedValueOnce({ id: 'ship-1', order: VALID_UUID })
        .mockResolvedValueOnce({ id: 'dict-1', key: 'sales.shipment_status' })

      mockFindWithDecryption.mockResolvedValueOnce([
        { id: 'entry-1', label: 'Pending', value: 'pending', normalizedValue: 'pending' },
        { id: 'entry-2', label: 'Shipped', value: 'shipped', normalizedValue: 'shipped' },
        { id: 'entry-3', label: 'Delivered', value: 'delivered', normalizedValue: 'delivered' },
      ])

      mockCommandBus.execute.mockResolvedValue({ result: { shipmentId: 'ship-1' } })

      const action = makeAction({
        id: 'a-ship',
        actionType: 'update_shipment',
        payload: {
          orderId: VALID_UUID,
          statusLabel: 'Shipped',
          trackingNumbers: ['TRACK-123'],
          carrierName: 'DHL',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('ship-1')
      expect(result.createdEntityType).toBe('sales_shipment')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.shipments.update',
        expect.objectContaining({
          input: expect.objectContaining({
            statusEntryId: 'entry-2',
            trackingNumbers: ['TRACK-123'],
            carrierName: 'DHL',
          }),
        }),
      )
    })

    it('fails when no shipment found for the order', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-ship-missing',
        actionType: 'update_shipment',
        status: 'processing',
        payload: {
          orderId: VALID_UUID,
          statusLabel: 'Shipped',
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({ id: VALID_UUID, orderNumber: 'ORD-001', currencyCode: 'EUR' })

      const action = makeAction({
        id: 'a-ship-missing',
        actionType: 'update_shipment',
        payload: {
          orderId: VALID_UUID,
          statusLabel: 'Shipped',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.error).toContain('No shipment found')
    })
  })

  describe('executeAction — link_contact', () => {
    it('returns matched entity without dispatching a command', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-link',
        actionType: 'link_contact',
        status: 'processing',
        payload: {
          emailAddress: 'john@example.com',
          contactId: VALID_UUID,
          contactType: 'person',
          contactName: 'John Doe',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-link',
        actionType: 'link_contact',
        payload: {
          emailAddress: 'john@example.com',
          contactId: VALID_UUID,
          contactType: 'person',
          contactName: 'John Doe',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe(VALID_UUID)
      expect(result.createdEntityType).toBe('customer_person')
      expect(mockCommandBus.execute).not.toHaveBeenCalled()
    })

    it('normalizes LLM-style field names (email/id/type/name) to schema-expected names', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-link-llm',
        actionType: 'link_contact',
        status: 'processing',
        payload: {
          email: 'john@example.com',
          id: VALID_UUID,
          type: 'Person',
          name: 'John Doe',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-link-llm',
        actionType: 'link_contact',
        payload: {
          email: 'john@example.com',
          id: VALID_UUID,
          type: 'Person',
          name: 'John Doe',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe(VALID_UUID)
      expect(result.createdEntityType).toBe('customer_person')
    })

    it('returns customer_company for company contact type', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-link-co',
        actionType: 'link_contact',
        status: 'processing',
        payload: {
          emailAddress: 'info@acme.com',
          contactId: VALID_UUID,
          contactType: 'company',
          contactName: 'Acme Corp',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-link-co',
        actionType: 'link_contact',
        payload: {
          emailAddress: 'info@acme.com',
          contactId: VALID_UUID,
          contactType: 'company',
          contactName: 'Acme Corp',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityType).toBe('customer_company')
    })
  })

  describe('executeAction — log_activity', () => {
    it('creates activity on contact via customers.activities.create', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-activity',
        actionType: 'log_activity',
        status: 'processing',
        payload: {
          contactId: VALID_UUID,
          contactType: 'person',
          contactName: 'Jane Doe',
          activityType: 'note',
          subject: 'Follow-up from email',
          body: 'Client requested updated pricing.',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      mockCommandBus.execute.mockResolvedValue({ result: { activityId: 'act-1' } })

      const action = makeAction({
        id: 'a-activity',
        actionType: 'log_activity',
        payload: {
          contactId: VALID_UUID,
          contactType: 'person',
          contactName: 'Jane Doe',
          activityType: 'note',
          subject: 'Follow-up from email',
          body: 'Client requested updated pricing.',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('act-1')
      expect(result.createdEntityType).toBe('customer_activity')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'customers.activities.create',
        expect.objectContaining({
          input: expect.objectContaining({
            entityId: VALID_UUID,
            activityType: 'note',
            subject: 'Follow-up from email',
          }),
        }),
      )
    })

    it('resolves contactId by name+type when missing', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-activity-resolve',
        actionType: 'log_activity',
        status: 'processing',
        payload: {
          contactType: 'person',
          contactName: 'Jane Doe',
          activityType: 'note',
          subject: 'Follow-up',
          body: 'Resolved contact body',
        },
      })
      mockFindOneWithDecryption
        .mockResolvedValueOnce(freshAction)
        .mockResolvedValueOnce({ id: 'resolved-contact-1', kind: 'person', displayName: 'Jane Doe' })

      mockCommandBus.execute.mockResolvedValue({ result: { activityId: 'act-resolved' } })

      const action = makeAction({
        id: 'a-activity-resolve',
        actionType: 'log_activity',
        payload: {
          contactType: 'person',
          contactName: 'Jane Doe',
          activityType: 'note',
          subject: 'Follow-up',
          body: 'Resolved contact body',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('act-resolved')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'customers.activities.create',
        expect.objectContaining({
          input: expect.objectContaining({ entityId: 'resolved-contact-1' }),
        }),
      )
    })

    it('fails when contactId is missing and cannot be resolved', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-activity-no-contact',
        actionType: 'log_activity',
        status: 'processing',
        payload: {
          contactType: 'person',
          contactName: 'Unknown',
          activityType: 'note',
          subject: 'Test',
          body: 'Test body',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-activity-no-contact',
        actionType: 'log_activity',
        payload: {
          contactType: 'person',
          contactName: 'Unknown',
          activityType: 'note',
          subject: 'Test',
          body: 'Test body',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.error).toContain('contactId')
      expect(result.error).toContain('Unknown')
    })
  })

  describe('executeAction — create_contact company', () => {
    it('creates company via customers.companies.create when type is company', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-company',
        actionType: 'create_contact',
        status: 'processing',
        payload: {
          type: 'company',
          name: 'Acme Corp',
          email: 'info@acme.com',
          companyName: 'Acme Corporation Ltd',
          source: 'inbox_ops',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)
      mockCommandBus.execute.mockResolvedValue({ result: { entityId: 'company-1' } })

      const action = makeAction({
        id: 'a-company',
        actionType: 'create_contact',
        payload: {
          type: 'company',
          name: 'Acme Corp',
          email: 'info@acme.com',
          companyName: 'Acme Corporation Ltd',
          source: 'inbox_ops',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('company-1')
      expect(result.createdEntityType).toBe('customer_company')
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'customers.companies.create',
        expect.objectContaining({
          input: expect.objectContaining({
            displayName: 'Acme Corp',
            legalName: 'Acme Corporation Ltd',
          }),
        }),
      )
    })

    it('returns existing company when email matches', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-company-dup',
        actionType: 'create_contact',
        status: 'processing',
        payload: {
          type: 'company',
          name: 'Acme Corp',
          email: 'info@acme.com',
          source: 'inbox_ops',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      mockFindOneWithDecryption.mockResolvedValueOnce({
        id: 'existing-company-1',
        kind: 'company',
        displayName: 'Acme Corp',
        primaryEmail: 'info@acme.com',
      })

      const action = makeAction({
        id: 'a-company-dup',
        actionType: 'create_contact',
        payload: {
          type: 'company',
          name: 'Acme Corp',
          email: 'info@acme.com',
          source: 'inbox_ops',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('existing-company-1')
      expect(result.createdEntityType).toBe('customer_company')
      expect(mockCommandBus.execute).not.toHaveBeenCalled()
    })
  })

  describe('executeAction — create_contact company requires customers.companies.manage', () => {
    it('checks customers.companies.manage when create_contact type is company', async () => {
      mockRbacService.userHasAllFeatures.mockResolvedValue(false)
      const em = createMockEm()

      const action = makeAction({
        id: 'a-company-perm',
        actionType: 'create_contact',
        payload: {
          type: 'company',
          name: 'Acme Corp',
          source: 'inbox_ops',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(403)
      expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        'user-1',
        ['customers.companies.manage'],
        expect.objectContaining({ tenantId: 'tenant-1' }),
      )
    })

    it('checks customers.people.manage when create_contact type is person', async () => {
      mockRbacService.userHasAllFeatures.mockResolvedValue(false)
      const em = createMockEm()

      const action = makeAction({
        id: 'a-person-perm',
        actionType: 'create_contact',
        payload: {
          type: 'person',
          name: 'Jane Doe',
          source: 'inbox_ops',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(403)
      expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        'user-1',
        ['customers.people.manage'],
        expect.objectContaining({ tenantId: 'tenant-1' }),
      )
    })
  })

  describe('executeAction — create_contact resolves cross-action unknown_contact discrepancies', () => {
    it('resolves unknown_contact discrepancies on other actions (e.g. draft_reply) for the same email', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-create-contact',
        proposalId: 'proposal-cross',
        actionType: 'create_contact',
        status: 'processing',
        payload: {
          type: 'person',
          name: 'Arjun Patel',
          email: 'arjun@example.com',
          source: 'inbox_ops',
        },
      })

      // 1. findOneWithDecryption: fresh action
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)
      // 2. findOneWithDecryption: no existing contact by DB query (triggers in-memory fallback)
      mockFindOneWithDecryption.mockResolvedValueOnce(null)
      // 2b. findWithDecryption: in-memory email fallback → no match (triggers create)
      mockFindWithDecryption.mockResolvedValueOnce([])
      // 3. command bus: create person
      mockCommandBus.execute.mockResolvedValueOnce({ result: { entityId: 'new-contact-1' } })

      // After execution: resolveActionDiscrepancies (for the create_contact action itself)
      // 4. findWithDecryption: discrepancies for this action ID → empty
      mockFindWithDecryption.mockResolvedValueOnce([])

      // After execution: resolveUnknownContactDiscrepanciesInProposal
      // 5. findWithDecryption: unknown_contact discrepancies in the proposal
      const draftReplyDiscrepancy = { id: 'disc-draft', proposalId: 'proposal-cross', type: 'unknown_contact', resolved: false, foundValue: 'arjun@example.com' }
      const otherDiscrepancy = { id: 'disc-other', proposalId: 'proposal-cross', type: 'unknown_contact', resolved: false, foundValue: 'other@example.com' }
      mockFindWithDecryption.mockResolvedValueOnce([draftReplyDiscrepancy, otherDiscrepancy])

      // recalculateProposalStatus
      // 6. findOneWithDecryption: proposal (for recalculate)
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      const action = makeAction({
        id: 'a-create-contact',
        proposalId: 'proposal-cross',
        actionType: 'create_contact',
        payload: {
          type: 'person',
          name: 'Arjun Patel',
          email: 'arjun@example.com',
          source: 'inbox_ops',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      // The matching discrepancy should be resolved
      expect(draftReplyDiscrepancy.resolved).toBe(true)
      // The non-matching discrepancy should NOT be resolved
      expect(otherDiscrepancy.resolved).toBe(false)
    })

    it('resolves unknown_contact discrepancies after link_contact using emailAddress field', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-link-cross',
        proposalId: 'proposal-link-cross',
        actionType: 'link_contact',
        status: 'processing',
        payload: {
          emailAddress: 'linked@example.com',
          contactId: VALID_UUID,
          contactType: 'person',
          contactName: 'Linked Person',
        },
      })

      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      // resolveActionDiscrepancies
      mockFindWithDecryption.mockResolvedValueOnce([])

      // resolveUnknownContactDiscrepanciesInProposal
      const discrepancy = { id: 'disc-link', proposalId: 'proposal-link-cross', type: 'unknown_contact', resolved: false, foundValue: 'linked@example.com' }
      mockFindWithDecryption.mockResolvedValueOnce([discrepancy])

      // recalculateProposalStatus
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      const action = makeAction({
        id: 'a-link-cross',
        proposalId: 'proposal-link-cross',
        actionType: 'link_contact',
        payload: {
          emailAddress: 'linked@example.com',
          contactId: VALID_UUID,
          contactType: 'person',
          contactName: 'Linked Person',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(discrepancy.resolved).toBe(true)
    })
  })

  describe('executeAction — link_contact normalizes matchedId/matchedType from pre-matched contacts format', () => {
    it('normalizes matchedId to contactId and matchedType to contactType', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-link-matched',
        actionType: 'link_contact',
        status: 'processing',
        payload: {
          contactEmail: 'hans@example.com',
          matchedId: VALID_UUID,
          matchedType: 'Person',
          displayName: 'Hans Mueller',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-link-matched',
        actionType: 'link_contact',
        payload: {
          contactEmail: 'hans@example.com',
          matchedId: VALID_UUID,
          matchedType: 'Person',
          displayName: 'Hans Mueller',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe(VALID_UUID)
      expect(result.createdEntityType).toBe('customer_person')
    })

    it('normalizes matchedContactId and matchedContactType variants', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-link-matched-2',
        actionType: 'link_contact',
        status: 'processing',
        payload: {
          email: 'naomi@example.com',
          matchedContactId: VALID_UUID,
          matchedContactType: 'person',
          name: 'Naomi Harris',
        },
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      const action = makeAction({
        id: 'a-link-matched-2',
        actionType: 'link_contact',
        payload: {
          email: 'naomi@example.com',
          matchedContactId: VALID_UUID,
          matchedContactType: 'person',
          name: 'Naomi Harris',
        },
      })

      const result = await executeAction(action, makeCtx(em))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe(VALID_UUID)
    })
  })

  describe('executeAction — create_order resolves channel from container when entities.SalesChannel is undefined', () => {
    it('resolves channel from container fallback when entities does not include SalesChannel', async () => {
      const em = createMockEm()
      em.nativeUpdate.mockResolvedValue(1)

      const freshAction = makeAction({
        id: 'a-order-no-channel',
        status: 'processing',
        payload: {
          customerName: 'Test Customer',
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        },
      })

      // findOneWithDecryption: fresh action
      mockFindOneWithDecryption.mockResolvedValueOnce(freshAction)

      // container.resolve('SalesChannel') fallback
      const MockSalesChannelFallback = class {} as unknown
      mockContainer.resolve.mockImplementation((token: string) => {
        if (token === 'rbacService') return mockRbacService
        if (token === 'commandBus') return mockCommandBus
        if (token === 'SalesChannel') return MockSalesChannelFallback
        return null
      })

      // findOneWithDecryption: resolveFirstChannelId (finds a channel)
      mockFindOneWithDecryption.mockResolvedValueOnce({
        id: 'channel-from-container',
        name: 'Online Store',
        metadata: null,
      })
      // findOneWithDecryption: resolveEffectiveDocumentKind
      mockFindOneWithDecryption.mockResolvedValueOnce({
        id: 'channel-from-container',
        name: 'Online Store',
        metadata: {},
      })

      mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-fallback' } })

      const action = makeAction({
        id: 'a-order-no-channel',
        payload: {
          customerName: 'Test Customer',
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        },
      })

      // Pass entities WITHOUT SalesChannel
      const result = await executeAction(action, makeCtx(em, {
        entities: {
          CustomerEntity: MockCustomerEntity,
          SalesOrder: MockSalesOrder,
          SalesShipment: MockSalesShipment,
          Dictionary: MockDictionary,
          DictionaryEntry: MockDictionaryEntry,
        },
      }))

      expect(result.success).toBe(true)
      expect(result.createdEntityId).toBe('order-fallback')
    })
  })

  describe('getRequiredFeature', () => {
    it.each([
      ['create_order', 'sales.orders.manage'],
      ['create_quote', 'sales.quotes.manage'],
      ['update_order', 'sales.orders.manage'],
      ['update_shipment', 'sales.shipments.manage'],
      ['create_contact', 'customers.people.manage'],
      ['link_contact', 'customers.people.manage'],
      ['log_activity', 'customers.activities.manage'],
      ['draft_reply', 'inbox_ops.replies.send'],
    ] as const)('returns correct feature for %s', (actionType, expectedFeature) => {
      expect(getRequiredFeature(actionType)).toBe(expectedFeature)
    })
  })
})
