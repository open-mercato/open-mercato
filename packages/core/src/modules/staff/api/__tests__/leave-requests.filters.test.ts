import { buildLeaveRequestFilters } from '../leave-requests'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

const { findWithDecryption, findOneWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find')

describe('buildLeaveRequestFilters (#4739)', () => {
  const NIL_UUID = '00000000-0000-0000-0000-000000000000'

  function createMockCtx(opts?: {
    userId?: string
    canManage?: boolean
    canSend?: boolean
    canViewSelf?: boolean
    memberRecord?: { id: string } | null
    foundMembers?: Array<{ id: string }>
  }): CrudCtx {
    const userId = opts?.userId ?? '11111111-1111-1111-1111-111111111111'
    const canManage = opts?.canManage ?? false
    const canSend = opts?.canSend ?? false
    const canViewSelf = opts?.canViewSelf ?? false
    const memberRecord = opts?.memberRecord ?? null
    const foundMembers = opts?.foundMembers ?? []

    const mockRbac = {
      userHasAllFeatures: jest.fn().mockImplementation((sub: string, features: string[]) => {
        if (features.includes('staff.leave_requests.manage')) return Promise.resolve(canManage)
        if (features.includes('staff.leave_requests.send')) return Promise.resolve(canSend)
        if (features.includes('staff.my_leave_requests.send')) return Promise.resolve(canSend)
        if (features.includes('staff.my_leave_requests.view')) return Promise.resolve(canViewSelf)
        return Promise.resolve(false)
      }),
    }

    const mockEm = {
      fork: jest.fn().mockReturnThis(),
    }

    findOneWithDecryption.mockResolvedValue(memberRecord)
    findWithDecryption.mockResolvedValue(foundMembers)

    return {
      auth: {
        sub: userId,
        tenantId: 'tenant-1',
        orgId: 'org-1',
      },
      organizationScope: { tenantId: 'tenant-1', selectedId: 'org-1' },
      selectedOrganizationId: 'org-1',
      container: {
        resolve: jest.fn((name: string) => {
          if (name === 'rbacService') return mockRbac
          if (name === 'em') return mockEm
          return null
        }),
      },
    } as unknown as CrudCtx
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('assigns NIL_UUID (not string sentinel __no_access__) when viewer has no manage access and no team-member record', async () => {
    const ctx = createMockCtx({
      canManage: false,
      canViewSelf: true,
      memberRecord: null,
    })

    const filters = await buildLeaveRequestFilters({ page: 1, pageSize: 50 }, ctx)

    expect(filters.id).toBe(NIL_UUID)
    expect(filters.id).not.toBe('__no_access__')
    expect(filters.id).not.toBe('__no_match__')
  })

  it('assigns NIL_UUID (not string sentinel __no_match__) when search query finds no team members', async () => {
    const ctx = createMockCtx({
      canManage: true,
      foundMembers: [],
    })

    const filters = await buildLeaveRequestFilters({ page: 1, pageSize: 50, search: 'NonExistent' }, ctx)

    expect(filters.id).toBe(NIL_UUID)
    expect(filters.id).not.toBe('__no_match__')
    expect(filters.id).not.toBe('__no_access__')
  })

  it('filters by member_id when viewer is not manager but has a valid team member record', async () => {
    const memberId = '22222222-2222-2222-2222-222222222222'
    const ctx = createMockCtx({
      canManage: false,
      canViewSelf: true,
      memberRecord: { id: memberId },
    })

    const filters = await buildLeaveRequestFilters({ page: 1, pageSize: 50 }, ctx)

    expect(filters.member_id).toBe(memberId)
    expect(filters.id).toBeUndefined()
  })

  it('combines search NIL_UUID filter and member_id scope for non-manager searching with no matches', async () => {
    const memberId = '22222222-2222-2222-2222-222222222222'
    const ctx = createMockCtx({
      canManage: false,
      canViewSelf: true,
      memberRecord: { id: memberId },
      foundMembers: [],
    })

    const filters = await buildLeaveRequestFilters({ page: 1, pageSize: 50, search: 'NonExistent' }, ctx)

    expect(filters.id).toBe(NIL_UUID)
    expect(filters.member_id).toBe(memberId)
  })
})
