/** @jest-environment node */

const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

import { resolveAttachmentOrganizationId } from '../requestScope'

const container = { resolve: jest.fn() } as any
const request = new Request('http://x/api/attachments')

describe('resolveAttachmentOrganizationId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefers the selected organization over the auth home organization', async () => {
    // Regression for #3765: a multi-org admin's auth.orgId stays pinned to their
    // home org, but the request scope resolves the currently selected org.
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'selected-org',
      filterIds: ['selected-org'],
      allowedIds: ['home-org', 'selected-org'],
      tenantId: 't1',
    })
    const auth = { sub: 'u1', tenantId: 't1', orgId: 'home-org' }
    const resolved = await resolveAttachmentOrganizationId(container, auth as any, request)
    expect(resolved).toBe('selected-org')
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ container, auth, request }),
    )
  })

  it('falls back to the auth home organization when no selection resolves', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 't1',
    })
    const auth = { sub: 'u1', tenantId: 't1', orgId: 'home-org' }
    const resolved = await resolveAttachmentOrganizationId(container, auth as any, request)
    expect(resolved).toBe('home-org')
  })

  it('returns null when there is no authenticated principal', async () => {
    const resolved = await resolveAttachmentOrganizationId(container, null, request)
    expect(resolved).toBeNull()
    expect(mockResolveOrganizationScopeForRequest).not.toHaveBeenCalled()
  })
})
