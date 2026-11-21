/** @jest-environment node */

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { saveRolePerspectives } from '../perspectiveService'

const ROLE_A = '11111111-1111-4111-8111-111111111111'
const ROLE_B = '22222222-2222-4222-8222-222222222222'
const EXISTING_ID = '33333333-3333-4333-8333-333333333333'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'

function existingRoleView() {
  return {
    id: EXISTING_ID,
    roleId: ROLE_A,
    tableId: 'customers',
    name: 'Pipeline (copy)',
    settingsJson: { original: true } as Record<string, unknown>,
    isDefault: false,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    createdAt: new Date(CURRENT_VERSION),
    updatedAt: new Date(CURRENT_VERSION),
  }
}

function makeEm(existing: Array<ReturnType<typeof existingRoleView>>) {
  return {
    find: jest.fn(async () => existing),
    findOne: jest.fn(async () => null),
    create: jest.fn((_ctor: unknown, data: Record<string, unknown>) => ({ ...data, id: `new-${String(data.roleId)}` })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 0),
  }
}

const baseOptions = { tableId: 'customers', tenantId: 'tenant-1', organizationId: 'org-1' }

describe('saveRolePerspectives createOnly (#8632)', () => {
  it('rejects with 409 duplicate_name when a target role already has a view with that name and mutates nothing', async () => {
    const record = existingRoleView()
    const em = makeEm([record])
    const cache = { deleteByTags: jest.fn(async () => undefined) }
    let caught: unknown
    try {
      await saveRolePerspectives(em as never, cache as never, {
        ...baseOptions,
        input: { roleIds: [ROLE_A, ROLE_B], name: 'Pipeline (copy)', settings: { pageSize: 50 }, setDefault: false },
        expectedUpdatedAtByPerspectiveId: { [EXISTING_ID]: CURRENT_VERSION },
        createOnly: true,
      })
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(409)
    expect((caught as { body: { code?: string } }).body.code).toBe('duplicate_name')
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(cache.deleteByTags).not.toHaveBeenCalled()
    expect(record.settingsJson).toEqual({ original: true })
    expect(record.updatedAt).toEqual(new Date(CURRENT_VERSION))
  })

  it('creates role views on a create-only save when no target role has that name', async () => {
    const em = makeEm([])
    const result = await saveRolePerspectives(em as never, null, {
      ...baseOptions,
      input: { roleIds: [ROLE_A, ROLE_B], name: 'Pipeline (copy)', settings: { pageSize: 50 }, setDefault: false },
      createOnly: true,
    })
    expect(result).toHaveLength(2)
    expect(em.create).toHaveBeenCalledTimes(2)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('keeps updating a name-matched role view in place when createOnly is not set', async () => {
    const record = existingRoleView()
    const em = makeEm([record])
    const result = await saveRolePerspectives(em as never, null, {
      ...baseOptions,
      input: { roleIds: [ROLE_A], name: 'Pipeline (copy)', settings: { pageSize: 50 }, setDefault: false },
      expectedUpdatedAtByPerspectiveId: { [EXISTING_ID]: CURRENT_VERSION },
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(EXISTING_ID)
    expect(em.create).not.toHaveBeenCalled()
    expect(record.settingsJson).toEqual({ pageSize: 50 })
  })
})
