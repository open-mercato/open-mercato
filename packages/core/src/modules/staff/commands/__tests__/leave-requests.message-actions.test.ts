import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message } from '@open-mercato/core/modules/messages/data/entities'
import { registerMessageTypes } from '@open-mercato/core/modules/messages/lib/message-types-registry'

const mockFindOne = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const requestId = '55555555-5555-4555-8555-555555555555'

beforeAll(async () => {
  await import('../leave-requests')
  await import('@open-mercato/core/modules/messages/commands/actions')
  registerMessageTypes([{
    type: 'staff.authorization_test', module: 'staff', labelKey: 'staff.test', icon: 'bell',
    defaultActions: ['accept', 'reject'].map((decision) => ({ id: decision, label: decision, commandId: `staff.leave-requests.${decision}` })),
  }])
})

it.each(['accept', 'reject'])('message %s denial releases its terminal claim and leaves business state untouched', async (decision) => {
  const message = {
    id: messageId, type: 'staff.authorization_test', tenantId, organizationId,
    sourceEntityId: requestId, deletedAt: null, actionTaken: null,
    actionTakenByUserId: null, actionTakenAt: null, actionResult: null,
  }
  const em = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue({ recipientUserId: userId }),
    find: jest.fn().mockResolvedValue([]),
    nativeUpdate: jest.fn(async (_entity: unknown, _where: unknown, data: Record<string, unknown>) => { Object.assign(message, data); return 1 }),
    flush: jest.fn(),
  }
  mockFindOne.mockReset().mockImplementation(async (_em: unknown, entity: unknown) => entity === Message ? message : null)
  const permission = jest.fn().mockResolvedValue(false)
  const nestedExecute = jest.fn(async (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => {
    const target = commandRegistry.get(commandId)
    if (!target) throw new Error('Command not registered')
    return { result: await target.execute(options.input, options.ctx) }
  })
  const ctx: CommandRuntimeContext = {
    auth: { sub: userId, tenantId, orgId: organizationId },
    organizationScope: null, selectedOrganizationId: organizationId, organizationIds: [organizationId],
    container: { resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'commandBus') return { execute: nestedExecute }
      if (token === 'rbacService') return { userHasAllFeatures: permission }
      return null
    } } as unknown as CommandRuntimeContext['container'],
  }
  const command = commandRegistry.get('messages.actions.execute')
  if (!command) throw new Error('Command not registered')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(command.execute({ messageId, actionId: decision, tenantId, organizationId, userId, payload: { id: requestId } }, ctx))
      .rejects.toMatchObject({ status: 403 })
    expect(message).toMatchObject({ actionTaken: null, actionTakenByUserId: null, actionTakenAt: null, actionResult: null })
  }
  expect(permission).toHaveBeenCalledWith(userId, ['staff.leave_requests.manage'], { tenantId, organizationId })
  expect(mockFindOne.mock.calls.every((call) => call[1] === Message)).toBe(true)
  expect(em.flush).not.toHaveBeenCalled()
  expect(nestedExecute).toHaveBeenCalledTimes(2)
  expect(em.nativeUpdate).toHaveBeenCalledTimes(4)
})
