/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  clearRolePerspectives,
  deleteUserPerspective,
  saveRolePerspectives,
  saveUserPerspective,
} from '../perspectiveService'

const PERSPECTIVE_ID = '123e4567-e89b-12d3-a456-426614174200'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174201'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const NEXT_VERSION = '2026-06-01T10:05:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

function existingEntity() {
  return {
    id: PERSPECTIVE_ID,
    userId: 'user-1',
    tableId: 'customers',
    name: 'My View',
    settingsJson: {},
    isDefault: false,
    createdAt: new Date(CURRENT_VERSION),
    updatedAt: new Date(CURRENT_VERSION),
  }
}

function makeEm(entity: ReturnType<typeof existingEntity> | null) {
  return {
    findOne: jest.fn(async () => entity),
    create: jest.fn((_ctor: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => undefined),
  }
}

function existingRoleEntity(overrides: Partial<ReturnType<typeof existingRoleEntityBase>> = {}) {
  return { ...existingRoleEntityBase(), ...overrides }
}

function existingRoleEntityBase() {
  return {
    id: 'role-perspective-1',
    roleId: ROLE_ID,
    tableId: 'customers',
    name: 'Role View',
    settingsJson: {},
    isDefault: false,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    createdAt: new Date(CURRENT_VERSION),
    updatedAt: new Date(CURRENT_VERSION),
  }
}

function makeRoleEm(existing: Array<ReturnType<typeof existingRoleEntity>> = []) {
  return {
    find: jest.fn(async () => existing),
    findOne: jest.fn(async () => null),
    create: jest.fn((_ctor: unknown, data: Record<string, unknown>) => ({ ...data, id: `id-${data.roleId}` })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => undefined),
  }
}

function makeRoleEmWithFindResults(...results: Array<Array<ReturnType<typeof existingRoleEntity>>>) {
  const em = makeRoleEm()
  for (const result of results) {
    em.find.mockResolvedValueOnce(result)
  }
  return em
}

function requestWithHeader(headerValue?: string): Request {
  const headers: Record<string, string> = {}
  if (headerValue) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerValue
  return new Request('http://localhost/api/perspectives/customers', { method: 'POST', headers })
}

const scope = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const baseInput = { name: 'My View', settings: {} as Record<string, unknown> }

function expectConflict(err: unknown) {
  expect(isCrudHttpError(err)).toBe(true)
  expect((err as { status: number }).status).toBe(409)
}

describe('saveUserPerspective optimistic locking (#2055 saved views)', () => {
  beforeEach(() => {
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  it('throws a 409 CrudHttpError when updating an existing view with a stale version', async () => {
    const em = makeEm(existingEntity())
    let caught: unknown
    try {
      await saveUserPerspective(em as never, null, {
        scope,
        tableId: 'customers',
        input: { ...baseInput, perspectiveId: PERSPECTIVE_ID },
        request: requestWithHeader(STALE_VERSION),
      })
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('updates when the version matches', async () => {
    const em = makeEm(existingEntity())
    await expect(saveUserPerspective(em as never, null, {
      scope,
      tableId: 'customers',
      input: { ...baseInput, perspectiveId: PERSPECTIVE_ID },
      request: requestWithHeader(CURRENT_VERSION),
    })).resolves.toBeTruthy()
    expect(em.flush).toHaveBeenCalled()
  })

  it('is a no-op lock (updates) when no version header is sent (strictly additive)', async () => {
    const em = makeEm(existingEntity())
    await expect(saveUserPerspective(em as never, null, {
      scope,
      tableId: 'customers',
      input: { ...baseInput, perspectiveId: PERSPECTIVE_ID },
      request: requestWithHeader(),
    })).resolves.toBeTruthy()
    expect(em.flush).toHaveBeenCalled()
  })

  it('does not enforce on a brand-new view (no perspectiveId)', async () => {
    const em = makeEm(null)
    await expect(saveUserPerspective(em as never, null, {
      scope,
      tableId: 'customers',
      input: baseInput,
      request: requestWithHeader(STALE_VERSION),
    })).resolves.toBeTruthy()
    expect(em.flush).toHaveBeenCalled()
  })
})

describe('perspectives delete and role defaults optimistic locking (#3275)', () => {
  beforeEach(() => {
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  it('throws a 409 when deleting a personal view with a stale version', async () => {
    const em = makeEm(existingEntity())
    let caught: unknown
    try {
      await deleteUserPerspective(em as never, null, {
        scope,
        tableId: 'customers',
        perspectiveId: PERSPECTIVE_ID,
        request: requestWithHeader(STALE_VERSION),
      } as never)
    } catch (err) {
      caught = err
    }

    expectConflict(caught)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('throws a 409 when a locked personal delete targets an already-gone view', async () => {
    const em = makeEm(null)
    let caught: unknown
    try {
      await deleteUserPerspective(em as never, null, {
        scope,
        tableId: 'customers',
        perspectiveId: PERSPECTIVE_ID,
        request: requestWithHeader(STALE_VERSION),
      } as never)
    } catch (err) {
      caught = err
    }

    expectConflict(caught)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('throws a 409 when updating an existing role perspective with a stale role version', async () => {
    const em = makeRoleEm([existingRoleEntity()])
    let caught: unknown
    try {
      await saveRolePerspectives(em as never, null, {
        tableId: 'customers',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        input: {
          roleIds: [ROLE_ID],
          name: 'Role View',
          settings: {},
          setDefault: false,
        },
        expectedUpdatedAtByRoleId: { [ROLE_ID]: STALE_VERSION },
      } as never)
    } catch (err) {
      caught = err
    }

    expectConflict(caught)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('throws a 409 when clearing a role perspective with a stale role version', async () => {
    const em = makeRoleEm([existingRoleEntity()])
    let caught: unknown
    try {
      await clearRolePerspectives(em as never, null, {
        tableId: 'customers',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        roleIds: [ROLE_ID],
        expectedUpdatedAtByRoleId: { [ROLE_ID]: STALE_VERSION },
      } as never)
    } catch (err) {
      caught = err
    }

    expectConflict(caught)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('clears multiple role perspectives when every row has a current per-row version', async () => {
    const first = existingRoleEntity({ id: 'role-perspective-1', updatedAt: new Date(CURRENT_VERSION) })
    const second = existingRoleEntity({ id: 'role-perspective-2', name: 'Second View', updatedAt: new Date(NEXT_VERSION) })
    const em = makeRoleEm([first, second])

    await clearRolePerspectives(em as never, null, {
      tableId: 'customers',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      roleIds: [ROLE_ID],
      expectedUpdatedAtByPerspectiveId: {
        [first.id]: CURRENT_VERSION,
        [second.id]: NEXT_VERSION,
      },
    } as never)

    expect(em.nativeUpdate).toHaveBeenCalled()
  })

  it('throws a 409 when a per-row role clear omits an existing row version', async () => {
    const first = existingRoleEntity({ id: 'role-perspective-1', updatedAt: new Date(CURRENT_VERSION) })
    const second = existingRoleEntity({ id: 'role-perspective-2', name: 'Second View', updatedAt: new Date(NEXT_VERSION) })
    const em = makeRoleEm([first, second])
    let caught: unknown
    try {
      await clearRolePerspectives(em as never, null, {
        tableId: 'customers',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        roleIds: [ROLE_ID],
        expectedUpdatedAtByPerspectiveId: {
          [first.id]: CURRENT_VERSION,
        },
      } as never)
    } catch (err) {
      caught = err
    }

    expectConflict(caught)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('throws a 409 before clearing a stale previous role default', async () => {
    const target = existingRoleEntity({
      id: 'role-perspective-target',
      name: 'Role View',
      isDefault: false,
      updatedAt: new Date(CURRENT_VERSION),
    })
    const previousDefault = existingRoleEntity({
      id: 'role-perspective-default',
      name: 'Previous Default',
      isDefault: true,
      updatedAt: new Date(CURRENT_VERSION),
    })
    const em = makeRoleEmWithFindResults([target], [previousDefault])
    let caught: unknown
    try {
      await saveRolePerspectives(em as never, null, {
        tableId: 'customers',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        input: {
          roleIds: [ROLE_ID],
          name: 'Role View',
          settings: {},
          setDefault: true,
        },
        expectedUpdatedAtByPerspectiveId: {
          [target.id]: CURRENT_VERSION,
          [previousDefault.id]: STALE_VERSION,
        },
      } as never)
    } catch (err) {
      caught = err
    }

    expectConflict(caught)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
