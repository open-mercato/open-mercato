import type { AwilixContainer } from 'awilix'

const createMock = jest.fn()
const emitMock = jest.fn()

jest.mock('../../events', () => ({
  emitAiAssistantEvent: (...args: unknown[]) => emitMock(...args),
}))
jest.mock('../../data/repositories/AiModerationFlagRepository', () => ({
  AiModerationFlagRepository: jest.fn().mockImplementation(() => ({ create: createMock })),
}))

import { recordModerationFlag } from '../moderation-flag-recorder'

function fakeContainer(): AwilixContainer {
  return {
    resolve: () => ({ fork: () => ({}) }),
  } as unknown as AwilixContainer
}

const baseInput = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  agentId: 'customers.account_assistant',
  userId: 'user-1',
  providerId: 'openai',
  modelId: 'gpt-5-mini',
  categories: {
    hate: { flagged: true, score: 0.97 },
    violence: { flagged: false, score: 0.01 },
  },
}

describe('recordModerationFlag', () => {
  beforeEach(() => {
    createMock.mockReset()
    emitMock.mockReset()
    createMock.mockResolvedValue({ id: 'flag-1' })
    emitMock.mockResolvedValue(undefined)
  })

  it('persists the audit row and emits the event with only flagged categories', async () => {
    await recordModerationFlag(baseInput, fakeContainer())
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', agentId: 'customers.account_assistant', providerId: 'openai' }),
    )
    expect(emitMock).toHaveBeenCalledWith(
      'ai_assistant.moderation_flag.created',
      expect.objectContaining({ id: 'flag-1', tenantId: 'tenant-1', categories: ['hate'] }),
    )
  })

  it('skips entirely when tenantId is null (cannot tenant-scope the audit row)', async () => {
    await recordModerationFlag({ ...baseInput, tenantId: null }, fakeContainer())
    expect(createMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('skips when no container is available', async () => {
    await recordModerationFlag(baseInput, undefined)
    expect(createMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('swallows a persistence failure (never throws) and does not emit', async () => {
    createMock.mockRejectedValue(new Error('db down'))
    await expect(recordModerationFlag(baseInput, fakeContainer())).resolves.toBeUndefined()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('swallows an emit failure after a successful persist (never throws)', async () => {
    emitMock.mockRejectedValue(new Error('bus down'))
    await expect(recordModerationFlag(baseInput, fakeContainer())).resolves.toBeUndefined()
    expect(createMock).toHaveBeenCalledTimes(1)
  })
})
