/** @jest-environment node */

const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

import { resolveAttachmentRequestScope } from '../requestScope'

const container = { resolve: jest.fn() } as unknown as Parameters<typeof resolveAttachmentRequestScope>[0]
const request = new Request('http://x/api/attachments')

type Auth = Parameters<typeof resolveAttachmentRequestScope>[1]

describe('resolveAttachmentRequestScope', () => {
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
    const auth = { sub: 'u1', tenantId: 't1', orgId: 'home-org' } as Auth
    const resolved = await resolveAttachmentRequestScope(container, auth, request)
    expect(resolved).toEqual({ denied: false, organizationId: 'selected-org' })
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
    const auth = { sub: 'u1', tenantId: 't1', orgId: 'home-org' } as Auth
    const resolved = await resolveAttachmentRequestScope(container, auth, request)
    expect(resolved).toEqual({ denied: false, organizationId: 'home-org' })
  })

  it('denies an explicit empty scope instead of widening back to the home organization', async () => {
    // The deny is reported, not thrown: the file/image routes answer it with their
    // own 404 so a foreign-tenant id stays indistinguishable from a missing one,
    // and an uncaught CrudHttpError can never surface as a 500.
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId: 't1',
    })
    const auth = { sub: 'u1', tenantId: 't1', orgId: 'home-org' } as Auth

    const resolved = await resolveAttachmentRequestScope(container, auth, request)
    expect(resolved).toEqual({ denied: true, organizationId: null })
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it('returns no organization when there is no authenticated principal', async () => {
    const resolved = await resolveAttachmentRequestScope(container, null, request)
    expect(resolved).toEqual({ denied: false, organizationId: null })
    expect(mockResolveOrganizationScopeForRequest).not.toHaveBeenCalled()
  })
})
