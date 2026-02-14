import {
  isTerminalMessageAction,
  resolveActionCommandInput,
  type ResolvedMessageAction,
} from '../actions'
import type { Message } from '../../data/entities'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    type: 'sales.payment.update',
    threadId: null,
    parentMessageId: null,
    senderUserId: 'user-1',
    subject: 'Update payment',
    body: 'Please update payment amount',
    bodyFormat: 'text',
    priority: 'normal',
    status: 'sent',
    isDraft: false,
    sentAt: new Date('2026-02-14T10:00:00.000Z'),
    actionData: null,
    actionResult: null,
    actionTaken: null,
    actionTakenByUserId: null,
    actionTakenAt: null,
    sendViaEmail: false,
    tenantId: '11111111-1111-1111-8111-111111111111',
    organizationId: '22222222-2222-2222-8222-222222222222',
    createdAt: new Date('2026-02-14T10:00:00.000Z'),
    updatedAt: new Date('2026-02-14T10:00:00.000Z'),
    deletedAt: null,
    visibility: null,
    sourceEntityType: 'sales_payment',
    sourceEntityId: '33333333-3333-3333-8333-333333333333',
    externalEmail: null,
    externalName: null,
    ...overrides,
  } as Message
}

function createAction(overrides: Partial<ResolvedMessageAction> = {}): ResolvedMessageAction {
  return {
    id: 'object:obj-1:update_payment',
    label: 'Update payment',
    source: 'object',
    commandId: 'sales.payments.update',
    objectRef: {
      objectId: 'obj-1',
      entityModule: 'sales',
      entityType: 'sales_payment',
      entityId: '44444444-4444-4444-8444-444444444444',
    },
    ...overrides,
  }
}

describe('resolveActionCommandInput', () => {
  it('returns request body with action metadata', () => {
    const message = createMessage()
    const action = createAction()

    const input = resolveActionCommandInput(
      action,
      message,
      {
        tenantId: 'aaaaaaaa-aaaa-aaaa-8aaa-aaaaaaaaaaaa',
        organizationId: 'bbbbbbbb-bbbb-bbbb-8bbb-bbbbbbbbbbbb',
        userId: 'user-1',
      },
      { amount: 123.45 },
    )

    expect(input).toMatchObject({
      amount: 123.45,
      _messageId: 'message-1',
      _actionId: 'object:obj-1:update_payment',
    })
  })

  it('keeps user-provided values and enforces metadata keys', () => {
    const message = createMessage()
    const action = createAction()

    const input = resolveActionCommandInput(
      action,
      message,
      {
        tenantId: 'aaaaaaaa-aaaa-aaaa-8aaa-aaaaaaaaaaaa',
        organizationId: 'bbbbbbbb-bbbb-bbbb-8bbb-bbbbbbbbbbbb',
        userId: 'user-1',
      },
      {
        organizationId: 'cccccccc-cccc-cccc-8ccc-cccccccccccc',
        amount: 11,
        _messageId: 'override-attempt',
      },
    )

    expect(input.organizationId).toBe('cccccccc-cccc-cccc-8ccc-cccccccccccc')
    expect(input.amount).toBe(11)
    expect(input._messageId).toBe('message-1')
    expect(input._actionId).toBe('object:obj-1:update_payment')
  })
})

describe('isTerminalMessageAction', () => {
  it('returns explicit isTerminal value when provided', () => {
    expect(isTerminalMessageAction({ isTerminal: false })).toBe(false)
    expect(isTerminalMessageAction({ isTerminal: true })).toBe(true)
  })

  it('defaults command actions to terminal', () => {
    expect(isTerminalMessageAction({ commandId: 'sales.orders.approve' })).toBe(true)
  })

  it('defaults href actions to non-terminal', () => {
    expect(isTerminalMessageAction({ href: '/backend/sales/orders/1' })).toBe(false)
  })
})
