import { fetchRoleOptions } from '../roleOptions'

const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

describe('fetchRoleOptions', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  const mockRolesResponse = (items: Array<{ id: string; name: string }>) => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { items },
    })
  }

  it('returns role options with value and label', async () => {
    mockRolesResponse([
      { id: 'role-1', name: 'admin' },
      { id: 'role-2', name: 'employee' },
    ])

    const result = await fetchRoleOptions()
    expect(result).toEqual([
      { value: 'role-1', label: 'admin' },
      { value: 'role-2', label: 'employee' },
    ])
  })

  it('filters out superadmin role by default', async () => {
    mockRolesResponse([
      { id: 'role-1', name: 'admin' },
      { id: 'role-sa', name: 'superadmin' },
      { id: 'role-2', name: 'employee' },
    ])

    const result = await fetchRoleOptions()
    expect(result).toEqual([
      { value: 'role-1', label: 'admin' },
      { value: 'role-2', label: 'employee' },
    ])
  })

  it('includes superadmin role when includeSuperAdmin is true', async () => {
    mockRolesResponse([
      { id: 'role-1', name: 'admin' },
      { id: 'role-sa', name: 'superadmin' },
      { id: 'role-2', name: 'employee' },
    ])

    const result = await fetchRoleOptions(undefined, { includeSuperAdmin: true })
    expect(result).toEqual([
      { value: 'role-1', label: 'admin' },
      { value: 'role-sa', label: 'superadmin' },
      { value: 'role-2', label: 'employee' },
    ])
  })

  it('filters out superadmin role when includeSuperAdmin is false', async () => {
    mockRolesResponse([
      { id: 'role-1', name: 'admin' },
      { id: 'role-sa', name: 'superadmin' },
    ])

    const result = await fetchRoleOptions(undefined, { includeSuperAdmin: false })
    expect(result).toEqual([
      { value: 'role-1', label: 'admin' },
    ])
  })

  it('filters out items with empty id or name', async () => {
    mockRolesResponse([
      { id: '', name: 'admin' },
      { id: 'role-2', name: '' },
      { id: 'role-3', name: 'employee' },
    ])

    const result = await fetchRoleOptions()
    expect(result).toEqual([
      { value: 'role-3', label: 'employee' },
    ])
  })

  it('returns empty array on API failure', async () => {
    mockApiCall.mockRejectedValue(new Error('network error'))

    const result = await fetchRoleOptions()
    expect(result).toEqual([])
  })

  it('passes tenantId as search param when provided', async () => {
    mockRolesResponse([{ id: 'role-1', name: 'admin' }])

    await fetchRoleOptions(undefined, { tenantId: 'tenant-123' })

    const calledUrl = mockApiCall.mock.calls[0][0] as string
    expect(calledUrl).toContain('tenantId=tenant-123')
  })

  it('passes search query as search param when provided', async () => {
    mockRolesResponse([{ id: 'role-1', name: 'admin' }])

    await fetchRoleOptions('adm')

    const calledUrl = mockApiCall.mock.calls[0][0] as string
    expect(calledUrl).toContain('search=adm')
  })
})
