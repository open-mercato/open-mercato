import {
  loadFirstRoleSidebarPreference,
  loadRoleSidebarPreferences,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import * as encryptionFind from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

type Row = Record<string, unknown>
type StoredPreference = { role: { id: string }; tenantId: string | null; settingsJson: Row }

const findMock = encryptionFind.findWithDecryption as jest.Mock

function matchesCondition(columnValue: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && '$in' in (condition as Row)) {
    const candidates = (condition as { $in: unknown[] }).$in
    if (columnValue === null) return false
    return candidates.some((candidate) => candidate !== null && candidate === columnValue)
  }
  return columnValue === (condition ?? null)
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Row[]).every((sub) => matchesWhere(row, sub))
    if (key === '$or') return (condition as Row[]).some((sub) => matchesWhere(row, sub))
    return matchesCondition(row[key] ?? null, condition)
  })
}

function storePreferences(preferences: StoredPreference[]) {
  findMock.mockImplementation(async (_em: unknown, _entity: unknown, where: Row) =>
    preferences.filter((pref) => matchesWhere({ role: pref.role.id, tenantId: pref.tenantId }, where)),
  )
}

const em = {} as Parameters<typeof loadRoleSidebarPreferences>[0]
const tenantA = '11111111-1111-1111-1111-111111111111'
const tenantB = '22222222-2222-2222-2222-222222222222'
const roleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const preference = (tenantId: string | null, group: string): StoredPreference => ({
  role: { id: roleId },
  tenantId,
  settingsJson: { groupOrder: [group] },
})

describe('sidebarPreferencesService — role preference tenant scope (#6029)', () => {
  beforeEach(() => {
    findMock.mockReset()
  })

  describe('loadRoleSidebarPreferences', () => {
    it('falls back to the role preference with tenant_id NULL', async () => {
      storePreferences([preference(null, 'global')])
      const map = await loadRoleSidebarPreferences(em, { roleIds: [roleId], tenantId: tenantA })
      expect(map.get(roleId)?.groupOrder).toEqual(['global'])
    })

    it('prefers the tenant preference over the one with tenant_id NULL', async () => {
      storePreferences([preference(null, 'global'), preference(tenantA, 'tenant')])
      const map = await loadRoleSidebarPreferences(em, { roleIds: [roleId], tenantId: tenantA })
      expect(map.get(roleId)?.groupOrder).toEqual(['tenant'])
    })

    it('never returns another tenant preference', async () => {
      storePreferences([preference(tenantB, 'other')])
      const map = await loadRoleSidebarPreferences(em, { roleIds: [roleId], tenantId: tenantA })
      expect(map.has(roleId)).toBe(false)
    })
  })

  describe('loadFirstRoleSidebarPreference', () => {
    it('falls back to the role preference with tenant_id NULL', async () => {
      storePreferences([preference(null, 'global')])
      const settings = await loadFirstRoleSidebarPreference(em, { roleIds: [roleId], tenantId: tenantA })
      expect(settings?.groupOrder).toEqual(['global'])
    })

    it('never returns another tenant preference', async () => {
      storePreferences([preference(tenantB, 'other')])
      const settings = await loadFirstRoleSidebarPreference(em, { roleIds: [roleId], tenantId: tenantA })
      expect(settings).toBeNull()
    })
  })
})
