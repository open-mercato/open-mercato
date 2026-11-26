import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

const recordLockService = { acquire: jest.fn() }
const container = { resolve: jest.fn(() => recordLockService) }
const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-home' }

function makeRequest() {
  return new Request('http://localhost/api/record_locks/acquire', { method: 'POST' })
}

describe('resolveRecordLocksApiContext organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(auth)
    ;(createRequestContainer as jest.Mock).mockResolvedValue(container)
  })

  test('denies a caller whose organization scope is explicitly empty', async () => {
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: null,
      scope: { selectedId: null, filterIds: null, allowedIds: [], tenantId: 'tenant-1' },
    })

    const result = await resolveRecordLocksApiContext(makeRequest())

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    expect(container.resolve).not.toHaveBeenCalled()
  })

  test('keeps a null organization for an unrestricted all-organizations caller', async () => {
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: null,
      scope: { selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-1' },
    })

    const result = await resolveRecordLocksApiContext(makeRequest())

    expect(result).not.toBeInstanceOf(Response)
    expect(result).toMatchObject({ organizationId: null, recordLockService })
  })

  test('passes the selected organization through unchanged', async () => {
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-selected',
      scope: { selectedId: 'org-selected', filterIds: ['org-selected'], allowedIds: ['org-selected', 'org-home'], tenantId: 'tenant-1' },
    })

    const result = await resolveRecordLocksApiContext(makeRequest())

    expect(result).toMatchObject({ organizationId: 'org-selected' })
  })
})
