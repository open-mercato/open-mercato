import { describe, it, expect, jest } from '@jest/globals'
import { Perspective, RolePerspective } from '../../data/entities'
import { loadPerspectivesState, saveUserPerspective } from '../perspectiveService'

const scope = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const tableId = 'orders'
const roleId = 'role-1'
const stamp = new Date('2026-01-01T00:00:00.000Z')

const legacyFilters = { status: ['open'], channel: ['web'] }
const treeFilters = {
  v: 2,
  root: { id: 'root', type: 'group', combinator: 'and', children: [{ id: 'rule-1', field: 'status', op: 'is', value: 'open' }] },
}

function storedRecords(settingsJson: Record<string, unknown>) {
  return {
    personal: { id: 'p-1', name: 'Mine', tableId, settingsJson, isDefault: false, createdAt: stamp, updatedAt: stamp },
    role: {
      id: 'r-1', roleId, tableId, name: 'Shared', settingsJson, isDefault: false,
      tenantId: 'tenant-1', organizationId: 'org-1', createdAt: stamp, updatedAt: stamp,
    },
  }
}

function createMockEm(settingsJson: Record<string, unknown>) {
  const records = storedRecords(settingsJson)
  return {
    find: jest.fn(async (entity: unknown) => {
      if (entity === Perspective) return [records.personal]
      if (entity === RolePerspective) return [records.role]
      return []
    }),
  }
}

async function loadSettings(settingsJson: Record<string, unknown>) {
  const em = createMockEm(settingsJson)
  const state = await loadPerspectivesState(em as never, null, { scope, tableId, roleIds: [roleId] })
  return { personal: state.personal[0].settings, role: state.rolePerspectives[0].settings }
}

describe('perspective settings.filters on read', () => {
  it('returns a flat FilterValues record exactly as stored, for personal and role perspectives', async () => {
    const settingsJson = { pageSize: 25, filters: legacyFilters }
    const { personal, role } = await loadSettings(settingsJson)
    expect(personal).toEqual(settingsJson)
    expect(role).toEqual(settingsJson)
  })

  it('returns an advanced-filter tree unchanged, for personal and role perspectives', async () => {
    const settingsJson = { pageSize: 25, filters: treeFilters }
    const { personal, role } = await loadSettings(settingsJson)
    expect(personal).toEqual(settingsJson)
    expect(role).toEqual(settingsJson)
  })

  it('returns settings without filters with no filters key', async () => {
    const settingsJson = { pageSize: 25, columnVisibility: { name: true } }
    const { personal, role } = await loadSettings(settingsJson)
    expect(personal).toEqual(settingsJson)
    expect(personal).not.toHaveProperty('filters')
    expect(role).toEqual(settingsJson)
    expect(role).not.toHaveProperty('filters')
  })

  it('returns the flat FilterValues record from the save response', async () => {
    const em = {
      findOne: jest.fn(async () => null),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: 'p-new' })),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
    }
    const settings = { filters: legacyFilters }
    const saved = await saveUserPerspective(em as never, null, {
      scope,
      tableId,
      input: { name: 'Open web orders', settings },
    })
    expect(saved.settings).toEqual(settings)
  })
})
