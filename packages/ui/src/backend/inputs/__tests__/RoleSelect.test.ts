import { fetchRoleNameOptions } from '../RoleSelect'
import { apiCall } from '../../utils/apiCall'

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

function ok(items: Array<{ id?: string | null; name?: string | null }>) {
  return { ok: true, result: { items } } as any
}

describe('fetchRoleNameOptions', () => {
  beforeEach(() => { apiCallMock.mockReset() })

  it('returns role NAMES as the option value, not ids', async () => {
    apiCallMock.mockResolvedValue(ok([{ id: 'uuid-1', name: 'admin' }]))

    await expect(fetchRoleNameOptions()).resolves.toEqual([{ value: 'admin', label: 'admin' }])
  })

  it('excludes superadmin unless explicitly requested', async () => {
    apiCallMock.mockResolvedValue(ok([{ id: 'u1', name: 'admin' }, { id: 'u2', name: 'superadmin' }]))

    await expect(fetchRoleNameOptions()).resolves.toEqual([{ value: 'admin', label: 'admin' }])
    await expect(fetchRoleNameOptions(undefined, { includeSuperAdmin: true })).resolves.toEqual([
      { value: 'admin', label: 'admin' },
      { value: 'superadmin', label: 'superadmin' },
    ])
  })

  it('passes the search query through to the API', async () => {
    apiCallMock.mockResolvedValue(ok([]))

    await fetchRoleNameOptions('  man  ')

    expect(apiCallMock.mock.calls[0][0]).toContain('search=man')
  })

  it('omits tenantId when it is blank', async () => {
    apiCallMock.mockResolvedValue(ok([]))

    await fetchRoleNameOptions(undefined, { tenantId: '   ' })

    expect(apiCallMock.mock.calls[0][0]).not.toContain('tenantId')
  })

  it('returns [] when the caller lacks auth.roles.list so the field degrades to free text', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403 } as any)

    await expect(fetchRoleNameOptions()).resolves.toEqual([])
  })

  it('returns [] rather than throwing when the request fails', async () => {
    apiCallMock.mockRejectedValue(new Error('network down'))

    await expect(fetchRoleNameOptions()).resolves.toEqual([])
  })

  it('skips entries with a missing or blank name', async () => {
    apiCallMock.mockResolvedValue(ok([{ id: 'u1', name: '  ' }, { id: 'u2', name: null }, { id: 'u3', name: 'ops' }]))

    await expect(fetchRoleNameOptions()).resolves.toEqual([{ value: 'ops', label: 'ops' }])
  })
})
