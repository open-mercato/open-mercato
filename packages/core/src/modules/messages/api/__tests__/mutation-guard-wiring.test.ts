const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const actionId = '55555555-5555-4555-8555-555555555555'

const callOrder: string[] = []

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}

const commandBusExecuteMock = jest.fn()
const commandBus = {
  execute: (...args: unknown[]) => commandBusExecuteMock(...args),
}

const rbacService = {
  loadAcl: jest.fn(async () => ({ features: [], isSuperAdmin: false })),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return commandBus
    if (name === 'rbacService') return rbacService
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const runMessageMutationGuardsMock = jest.fn()
const runMessageMutationGuardAfterSuccessMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
    features: ['messages.compose', 'messages.view', 'messages.actions', 'messages.attach_files'],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown) => emInstance.find(entity, filters),
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown) => emInstance.findOne(entity, filters),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runMessageMutationGuards: (...args: unknown[]) => runMessageMutationGuardsMock(...args),
  runMessageMutationGuardAfterSuccess: (...args: unknown[]) => runMessageMutationGuardAfterSuccessMock(...args),
}))

import { POST as composeMessage } from '../route'
import { PATCH as updateDraft, DELETE as deleteMessage } from '../[id]/route'
import { PUT as markRead } from '../[id]/read/route'
import { POST as executeAction } from '../[id]/actions/[actionId]/route'
import { POST as replyMessage } from '../[id]/reply/route'
import { DELETE as deleteConversation } from '../[id]/conversation/route'

const REJECTION = {
  ok: false as const,
  errorStatus: 423,
  errorBody: { error: 'Record locked', guardId: 'record_locks.lock-check' },
  afterSuccessCallbacks: [],
}

function allowGuard() {
  runMessageMutationGuardsMock.mockImplementation(async () => {
    callOrder.push('guard:validate')
    return {
      ok: true,
      afterSuccessCallbacks: [{ guard: { id: 'g' }, metadata: { token: 'guard' } }],
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  callOrder.length = 0
  em.fork.mockReturnValue(em)
  em.find.mockResolvedValue([])
  em.findOne.mockResolvedValue(null)
  commandBusExecuteMock.mockImplementation(async () => {
    callOrder.push('command')
    return { result: { id: messageId, threadId: 'thread-1', ok: true, actionId, result: {}, operationLogEntry: null }, logEntry: null }
  })
  runMessageMutationGuardsMock.mockImplementation(async () => {
    callOrder.push('guard:validate')
    return { ok: true, afterSuccessCallbacks: [] }
  })
  runMessageMutationGuardAfterSuccessMock.mockImplementation(async () => {
    callOrder.push('guard:after')
  })
})

function composeRequest() {
  return new Request('http://localhost/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isDraft: true }),
  })
}

function draftMessage() {
  return { id: messageId, organizationId, senderUserId: userId, isDraft: true }
}

describe('messages compose route mutation guard wiring', () => {
  it('blocks the command when the guard rejects', async () => {
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await composeMessage(composeRequest())

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual(REJECTION.errorBody)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    allowGuard()

    const response = await composeMessage(composeRequest())

    expect(response.status).toBe(201)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.messages.compose', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.message', operation: 'create' }),
      expect.anything(),
    )
    expect(runMessageMutationGuardAfterSuccessMock).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })
})

describe('messages update-draft route mutation guard wiring', () => {
  it('blocks the command when the guard rejects', async () => {
    em.findOne.mockResolvedValue(draftMessage())
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await updateDraft(
      new Request('http://localhost/api/messages/x', { method: 'PATCH', body: JSON.stringify({ subject: 'edit' }) }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    em.findOne.mockResolvedValue(draftMessage())
    allowGuard()

    const response = await updateDraft(
      new Request('http://localhost/api/messages/x', { method: 'PATCH', body: JSON.stringify({ subject: 'edit' }) }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.messages.update_draft', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.message', resourceId: messageId, operation: 'update' }),
      expect.anything(),
    )
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })
})

describe('messages delete route mutation guard wiring', () => {
  it('blocks the command when the guard rejects', async () => {
    em.findOne.mockResolvedValue({ id: messageId, organizationId })
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await deleteMessage(
      new Request('http://localhost/api/messages/x', { method: 'DELETE' }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    em.findOne.mockResolvedValue({ id: messageId, organizationId })
    allowGuard()

    const response = await deleteMessage(
      new Request('http://localhost/api/messages/x', { method: 'DELETE' }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.messages.delete_for_actor', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.message', resourceId: messageId, operation: 'delete' }),
      expect.anything(),
    )
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })

  it('does not run after-success when the command throws', async () => {
    em.findOne.mockResolvedValue({ id: messageId, organizationId })
    allowGuard()
    commandBusExecuteMock.mockImplementation(async () => {
      callOrder.push('command')
      throw new Error('command boom')
    })

    await expect(
      deleteMessage(
        new Request('http://localhost/api/messages/x', { method: 'DELETE' }),
        { params: { id: messageId } },
      ),
    ).rejects.toThrow('command boom')

    expect(runMessageMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})

describe('messages mark-read route mutation guard wiring', () => {
  it('blocks the command when the guard rejects', async () => {
    em.findOne
      .mockResolvedValueOnce({ id: messageId, organizationId })
      .mockResolvedValueOnce({ id: 'recipient-1', messageId, recipientUserId: userId })
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await markRead(
      new Request('http://localhost/api/messages/x/read', { method: 'PUT' }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    em.findOne
      .mockResolvedValueOnce({ id: messageId, organizationId })
      .mockResolvedValueOnce({ id: 'recipient-1', messageId, recipientUserId: userId })
    allowGuard()

    const response = await markRead(
      new Request('http://localhost/api/messages/x/read', { method: 'PUT' }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.recipients.mark_read', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.message', resourceId: messageId, operation: 'update' }),
      expect.anything(),
    )
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })
})

describe('messages reply route mutation guard wiring', () => {
  function replyRequest() {
    return new Request('http://localhost/api/messages/x/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'reply text' }),
    })
  }

  it('blocks the command when the guard rejects', async () => {
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await replyMessage(replyRequest(), { params: { id: messageId } })

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    allowGuard()

    const response = await replyMessage(replyRequest(), { params: { id: messageId } })

    expect(response.status).toBe(201)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.messages.reply', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.message', operation: 'create' }),
      expect.anything(),
    )
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })
})

describe('messages conversation-delete route mutation guard wiring', () => {
  it('blocks the command when the guard rejects', async () => {
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await deleteConversation(
      new Request('http://localhost/api/messages/x/conversation', { method: 'DELETE' }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    allowGuard()

    const response = await deleteConversation(
      new Request('http://localhost/api/messages/x/conversation', { method: 'DELETE' }),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.conversation.delete_for_actor', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.conversation', resourceId: messageId, operation: 'delete' }),
      expect.anything(),
    )
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })
})

describe('messages action-execute route mutation guard wiring', () => {
  it('blocks the command when the guard rejects', async () => {
    runMessageMutationGuardsMock.mockResolvedValue(REJECTION)

    const response = await executeAction(
      new Request('http://localhost/api/messages/x/actions/y', { method: 'POST', body: JSON.stringify({}) }),
      { params: { id: messageId, actionId } },
    )

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('validates before dispatching and runs after-success only after the command', async () => {
    allowGuard()

    const response = await executeAction(
      new Request('http://localhost/api/messages/x/actions/y', { method: 'POST', body: JSON.stringify({}) }),
      { params: { id: messageId, actionId } },
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith('messages.actions.execute', expect.anything())
    expect(runMessageMutationGuardsMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'messages.message', resourceId: messageId, operation: 'update' }),
      expect.anything(),
    )
    expect(callOrder).toEqual(['guard:validate', 'command', 'guard:after'])
  })
})
