/** @jest-environment node */

const mockEm = { fork: jest.fn(() => mockEm) }
const mockSendAsUser = jest.fn(async () => ({ ok: true, messageId: 'm1', threadId: 't1' }))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'communicationChannelsSendAsUser') return mockSendAsUser
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => {}),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { validateCrudMutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard'
import { POST } from '../route'

const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const CHANNEL_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

function request() {
  return new Request(`http://localhost/api/customers/people/${PERSON_ID}/emails`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userChannelId: CHANNEL_ID, to: ['x@y.io'], subject: 'hi', body: 'hello' }),
  })
}

describe('POST person emails — organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: PERSON_ID, organizationId: 'org-9' })
  })

  it('finds the person by tenant+id under "All organizations" and attributes the send to the record\'s org', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', orgId: null, isSuperAdmin: true,
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-1',
    })

    const response = await POST(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(200)
    const personWhere = (findOneWithDecryption as jest.Mock).mock.calls[0][2]
    expect(personWhere).toMatchObject({ id: PERSON_ID, kind: 'person', tenantId: 'tenant-1' })
    expect(personWhere).not.toHaveProperty('organizationId')
    // Guard + outbound send are attributed to the person's real org, not null.
    expect(validateCrudMutationGuard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-9' }),
    )
    expect(mockSendAsUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-9' }),
      expect.anything(),
    )
  })

  it('denies a restricted caller who cannot see the record\'s organization', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-a',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null, filterIds: ['org-a'], allowedIds: ['org-a'], tenantId: 'tenant-1',
    })

    const response = await POST(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(404)
    expect(validateCrudMutationGuard).not.toHaveBeenCalled()
    expect(mockSendAsUser).not.toHaveBeenCalled()
  })
})
