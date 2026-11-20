/** @jest-environment node */

const mockEm = { fork: jest.fn(() => mockEm) }
const mockSendAsUser = jest.fn(async () => ({ ok: true, messageId: 'm1', threadId: 't1' }))
const mockUserHasAllFeatures = jest.fn(async () => true)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'communicationChannelsSendAsUser') return mockSendAsUser
      if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/core/modules/customers/lib/conversationShares', () => ({
  listGrantsForViewerOnPerson: jest.fn(async () => [{ personEntityId: 'p', ownerUserId: 'owner-1' }]),
  listSharedChannelIds: jest.fn(async () => ['channel-shared']),
}))

jest.mock('@open-mercato/core/modules/customers/lib/personEmailThreads', () => ({
  isMessageOnPersonEmailHistory: jest.fn(),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { validateCrudMutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  listGrantsForViewerOnPerson,
  listSharedChannelIds,
} from '@open-mercato/core/modules/customers/lib/conversationShares'
import { isMessageOnPersonEmailHistory } from '@open-mercato/core/modules/customers/lib/personEmailThreads'
import { POST } from '../route'

const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const CHANNEL_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const PARENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const onHistory = isMessageOnPersonEmailHistory as jest.Mock

function request(extra: Record<string, unknown> = {}) {
  return new Request(`http://localhost/api/customers/people/${PERSON_ID}/emails`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userChannelId: CHANNEL_ID,
      to: ['x@y.io'],
      subject: 'Re: hi',
      body: 'hello',
      parentMessageId: PARENT_ID,
      ...extra,
    }),
  })
}

describe('POST person emails — reply parent must be on the Person email history', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUserHasAllFeatures.mockResolvedValue(true)
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-b', tenantId: 'tenant-1', orgId: 'org-9' })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-9', filterIds: ['org-9'], allowedIds: ['org-9'], tenantId: 'tenant-1',
    })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: PERSON_ID, organizationId: 'org-9' })
  })

  it('checks the parent with the same viewer, shares and shared mailboxes as the Emails tab', async () => {
    onHistory.mockResolvedValue(true)

    const response = await POST(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(200)
    const shareScope = { tenantId: 'tenant-1', organizationId: 'org-9' }
    expect(listGrantsForViewerOnPerson).toHaveBeenCalledWith(mockEm, shareScope, 'user-b', PERSON_ID)
    expect(listSharedChannelIds).toHaveBeenCalledWith(mockEm, shareScope, 'user-b')
    expect(onHistory).toHaveBeenCalledWith(mockEm, {
      personId: PERSON_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-9',
      viewerUserId: 'user-b',
      userFeatures: undefined,
      sharedConversations: [{ personEntityId: 'p', ownerUserId: 'owner-1' }],
      sharedChannelIds: ['channel-shared'],
      messageId: PARENT_ID,
    })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith('user-b', ['customers.people.view'], shareScope)
    expect(mockSendAsUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ parentMessageId: PARENT_ID }),
    )
  })

  it('refuses a parent that is not on the caller view of this Person, before the guard and the send', async () => {
    onHistory.mockResolvedValue(false)

    const response = await POST(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'The email you are replying to was not found' })
    expect(validateCrudMutationGuard).not.toHaveBeenCalled()
    expect(mockSendAsUser).not.toHaveBeenCalled()
  })

  it('refuses a parent when the caller cannot read people at all, answering like an unknown id', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)
    onHistory.mockResolvedValue(true)

    const response = await POST(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'The email you are replying to was not found' })
    expect(onHistory).not.toHaveBeenCalled()
    expect(mockSendAsUser).not.toHaveBeenCalled()
  })

  it('treats an API key as a viewer with no private mail of its own', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'api_key:key-1', tenantId: 'tenant-1', orgId: 'org-9', isApiKey: true,
    })
    onHistory.mockResolvedValue(false)

    const response = await POST(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(404)
    expect(onHistory.mock.calls[0][1]).toMatchObject({ viewerUserId: null })
    expect(mockSendAsUser).not.toHaveBeenCalled()
  })

  it('leaves a send without a parent untouched', async () => {
    const response = await POST(request({ parentMessageId: undefined }), { params: { id: PERSON_ID } })

    expect(response.status).toBe(200)
    expect(onHistory).not.toHaveBeenCalled()
    expect(mockUserHasAllFeatures).not.toHaveBeenCalled()
  })
})
