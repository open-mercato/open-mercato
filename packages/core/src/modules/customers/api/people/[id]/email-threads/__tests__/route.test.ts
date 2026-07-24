/** @jest-environment node */

const mockEm = {
  fork: jest.fn(() => mockEm),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../../../../lib/personEmailThreads', () => ({
  buildPersonEmailThreads: jest.fn(async () => []),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { buildPersonEmailThreads } from '../../../../../lib/personEmailThreads'
import { GET } from '../route'

const PERSON_ID = '44444444-4444-4444-8444-444444444444'

function request() {
  return new Request(`http://localhost/api/customers/people/${PERSON_ID}/email-threads`)
}

describe('person email-threads — organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: PERSON_ID, organizationId: 'org-x' })
  })

  it('loads the person by tenant + id under "All organizations" and uses the record\'s own org', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: true,
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await GET(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(200)
    const where = (findOneWithDecryption as jest.Mock).mock.calls[0][2]
    expect(where).toMatchObject({ id: PERSON_ID, kind: 'person', tenantId: 'tenant-1' })
    expect(where).not.toHaveProperty('organizationId')
    // Downstream thread query is scoped to the person's real organization.
    expect(buildPersonEmailThreads).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ personId: PERSON_ID, organizationId: 'org-x' }),
    )
  })

  it('denies a restricted caller who cannot see the record\'s organization', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-a',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: ['org-a'],
      allowedIds: ['org-a'],
      tenantId: 'tenant-1',
    })

    const response = await GET(request(), { params: { id: PERSON_ID } })

    expect(response.status).toBe(404)
    expect(buildPersonEmailThreads).not.toHaveBeenCalled()
  })
})
