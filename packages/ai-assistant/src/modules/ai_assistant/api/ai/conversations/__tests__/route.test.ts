const authMock = jest.fn()
const loadAclMock = jest.fn()
const hasAllFeaturesMock = jest.fn()
const createRequestContainerMock = jest.fn()
const listConversationsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../lib/conversation-storage', () => ({
  createConversationStorage: jest.fn(() => ({
    list: (...args: unknown[]) => listConversationsMock(...args),
  })),
  serializeAiChatConversation: (row: unknown) => row,
}))

import { GET } from '../route'

function buildRequest(query = ''): Request {
  return new Request(`http://localhost/api/ai_assistant/ai/conversations${query}`, {
    method: 'GET',
  })
}

describe('GET /api/ai/conversations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    hasAllFeaturesMock.mockImplementation((required: string[], features: string[]) =>
      required.every((feature) => features.includes(feature)),
    )
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: (...args: unknown[]) => loadAclMock(...args),
            hasAllFeatures: (...args: unknown[]) => hasAllFeaturesMock(...args),
          }
        }
        return null
      },
    })
    loadAclMock.mockResolvedValue({
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
    })
    listConversationsMock.mockResolvedValue({ items: [], nextCursor: null })
  })

  it('passes owner-only scope to storage for view-only callers', async () => {
    const response = await GET(buildRequest('?agent=catalog.assistant') as any)
    expect(response.status).toBe(200)
    expect(listConversationsMock).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        canManageConversations: false,
      },
      expect.objectContaining({
        agentId: 'catalog.assistant',
      }),
    )
  })

  it('passes tenant-scoped manage scope when the caller has conversation management', async () => {
    loadAclMock.mockResolvedValueOnce({
      features: ['ai_assistant.view', 'ai_assistant.conversations.manage'],
      isSuperAdmin: false,
    })

    const response = await GET(buildRequest() as any)
    expect(response.status).toBe(200)
    expect(listConversationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        canManageConversations: true,
      }),
      expect.any(Object),
    )
  })
})
