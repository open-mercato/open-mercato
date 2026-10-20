const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { normalizeRoleAclSnapshot, roleAclFingerprintSource, sameRoleAcl } from '../roleAclFingerprint'
import { readRoleAclEditorDataChange, roleAclEditorFormId } from '../roleAclEditorInjection'
import { assertRoleAclUnchanged } from '../roleAclBaseline'

const t = (key: string, fallback?: unknown) => (typeof fallback === 'string' ? `${key}|${fallback}` : key)

function response(status: number, result: unknown) {
  return { ok: status >= 200 && status < 300, status, result }
}

describe('role ACL fingerprint source', () => {
  it('normalizes like the ACL write and ignores grant order', () => {
    expect(normalizeRoleAclSnapshot({ isSuperAdmin: 'yes', features: [' a ', 'a', 3, ''], organizations: 'x' })).toEqual({ isSuperAdmin: false, features: ['a'], organizations: null })
    expect(normalizeRoleAclSnapshot(null)).toEqual({ isSuperAdmin: false, features: [], organizations: null })
    expect(roleAclFingerprintSource({ isSuperAdmin: false, features: ['b', 'a'], organizations: ['o2', 'o1'] }))
      .toBe(roleAclFingerprintSource({ isSuperAdmin: false, features: ['a', 'b'], organizations: ['o1', 'o2'] }))
    expect(sameRoleAcl({ isSuperAdmin: false, features: [], organizations: null }, { isSuperAdmin: false, features: [], organizations: [] })).toBe(false)
    expect(sameRoleAcl({ isSuperAdmin: false, features: [], organizations: null }, { isSuperAdmin: true, features: [], organizations: null })).toBe(false)
  })
})

describe('role ACL editor injection', () => {
  it('names the editor document after the role and accepts only a valid ACL from a widget', () => {
    expect(roleAclEditorFormId('r1')).toBe('auth.role.acl:r1')
    expect(readRoleAclEditorDataChange({ roleId: 'other', isSuperAdmin: true, features: ['a', 'a'], organizations: null, extra: 1 }))
      .toEqual({ isSuperAdmin: true, features: ['a'], organizations: null })
    expect(readRoleAclEditorDataChange({ isSuperAdmin: 'true', features: [], organizations: null })).toBeNull()
    expect(readRoleAclEditorDataChange({ isSuperAdmin: false, features: 'a', organizations: null })).toBeNull()
    expect(readRoleAclEditorDataChange(null)).toBeNull()
  })
})

describe('assertRoleAclUnchanged (S15: an ACL without updatedAt is compared before writing)', () => {
  const baseline = { tenantId: null, isSuperAdmin: false, features: ['catalog.view'], organizations: null }
  const input = { roleId: 'role-1', tenantId: 'tenant-1', roleTenantId: 'tenant-1', baseline, t }

  beforeEach(() => apiCallMock.mockReset())

  it('lets the write proceed when the ACL is unchanged', async () => {
    apiCallMock.mockResolvedValue(response(200, { isSuperAdmin: false, features: ['catalog.view'], organizations: null, updatedAt: null }))
    await expect(assertRoleAclUnchanged(input)).resolves.toBeUndefined()
    expect(apiCallMock).toHaveBeenCalledWith('/api/auth/roles/acl?roleId=role-1&tenantId=tenant-1', { headers: { 'x-om-forbidden-redirect': '0' } })
  })

  it('refuses the write when someone else changed the ACL', async () => {
    apiCallMock.mockResolvedValue(response(200, { isSuperAdmin: false, features: ['catalog.view', 'catalog.edit'], organizations: null }))
    await expect(assertRoleAclUnchanged(input)).rejects.toThrow('auth.roles.form.errors.aclChanged')
  })

  it('leaves refused reads to the write and refuses the write when the read failed otherwise', async () => {
    apiCallMock.mockResolvedValue(response(403, { error: 'Forbidden' }))
    await expect(assertRoleAclUnchanged(input)).resolves.toBeUndefined()
    apiCallMock.mockResolvedValue(response(500, { error: 'boom' }))
    await expect(assertRoleAclUnchanged(input)).rejects.toThrow('auth.roles.form.errors.aclVerifyFailed')
  })

  it('compares nothing without a baseline or when the ACL is saved for another tenant than it was loaded for', async () => {
    await assertRoleAclUnchanged({ ...input, baseline: null })
    await assertRoleAclUnchanged({ ...input, tenantId: 'tenant-2' })
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
