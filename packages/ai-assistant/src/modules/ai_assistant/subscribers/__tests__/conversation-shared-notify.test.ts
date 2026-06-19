/**
 * Regression coverage for issue #2097 (BUG-004).
 *
 * Verifies that the conversation-shared notification subscriber persists a
 * resolved title/body string rather than the raw i18n key, so that
 * consumers that do not run the client renderer (email, export, digest)
 * see human-readable text instead of `ai_assistant.notifications.…`.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn(async () => ({
    'ai_assistant.notifications.conversation_shared.title': 'Conversation shared with you',
    'ai_assistant.notifications.conversation_shared.body':
      'An AI conversation has been shared with you.',
  })),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(),
}))

import handleConversationShared from '../conversation-shared-notify'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import type { AiConversationSharedPayload } from '../../events'

const RESOLVE_NOTIFICATION_SERVICE = resolveNotificationService as jest.MockedFunction<
  typeof resolveNotificationService
>

function makePayload(
  overrides: Partial<AiConversationSharedPayload> = {},
): AiConversationSharedPayload {
  return {
    conversationId: 'conv-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    ownerUserId: 'user-owner',
    participantUserId: 'user-recipient',
    role: 'viewer',
    ...overrides,
  }
}

function makeCtx(create: jest.Mock) {
  const container = { resolve: jest.fn() }
  RESOLVE_NOTIFICATION_SERVICE.mockReturnValue({ create } as never)
  return { resolve: (name: string) => container.resolve(name), container }
}

describe('conversation-shared-notify subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('persists a resolved default-locale title and body, not the raw i18n key', async () => {
    const create = jest.fn(async () => ({ ok: true }))
    const ctx = makeCtx(create)

    await handleConversationShared(makePayload(), ctx)

    expect(create).toHaveBeenCalledTimes(1)
    const [input] = create.mock.calls[0]
    expect(input.title).toBe('Conversation shared with you')
    expect(input.body).toBe('An AI conversation has been shared with you.')
    expect(input.titleKey).toBe('ai_assistant.notifications.conversation_shared.title')
    expect(input.bodyKey).toBe('ai_assistant.notifications.conversation_shared.body')
  })

  it('still calls the notification service with the recipient tenant scope', async () => {
    const create = jest.fn(async () => ({ ok: true }))
    const ctx = makeCtx(create)

    await handleConversationShared(makePayload(), ctx)

    const [, scope] = create.mock.calls[0]
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('returns early without calling create when participantUserId is missing', async () => {
    const create = jest.fn(async () => ({ ok: true }))
    const ctx = makeCtx(create)

    await handleConversationShared(
      makePayload({ participantUserId: '' as unknown as string }),
      ctx,
    )

    expect(create).not.toHaveBeenCalled()
  })

  it('returns early without calling create when tenantId is missing', async () => {
    const create = jest.fn(async () => ({ ok: true }))
    const ctx = makeCtx(create)

    await handleConversationShared(
      makePayload({ tenantId: '' as unknown as string }),
      ctx,
    )

    expect(create).not.toHaveBeenCalled()
  })

  it('falls back to the i18n key when the dictionary lookup throws', async () => {
    const i18nServer = jest.requireMock('@open-mercato/shared/lib/i18n/server')
    i18nServer.loadDictionary.mockRejectedValueOnce(new Error('dictionary unavailable'))
    const create = jest.fn(async () => ({ ok: true }))
    const ctx = makeCtx(create)

    await handleConversationShared(makePayload(), ctx)

    expect(create).toHaveBeenCalledTimes(1)
    const [input] = create.mock.calls[0]
    expect(input.title).toBe('ai_assistant.notifications.conversation_shared.title')
    expect(input.body).toBe('ai_assistant.notifications.conversation_shared.body')
  })
})
