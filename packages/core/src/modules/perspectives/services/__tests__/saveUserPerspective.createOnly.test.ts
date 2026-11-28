/** @jest-environment node */

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { saveUserPerspective } from '../perspectiveService'

const PERSPECTIVE_ID = '123e4567-e89b-12d3-a456-426614174200'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'

function existingEntity() {
  return {
    id: PERSPECTIVE_ID,
    userId: 'user-1',
    tableId: 'customers',
    name: 'My View',
    settingsJson: { original: true } as Record<string, unknown>,
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

const scope = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const request = new Request('http://localhost/api/perspectives/customers', { method: 'POST' })

function expectConflict(err: unknown) {
  expect(isCrudHttpError(err)).toBe(true)
  expect((err as { status: number }).status).toBe(409)
}

describe('saveUserPerspective without perspectiveId when the name is already taken', () => {
  it('rejects a create-only save with 409 duplicate_name and leaves the existing view untouched', async () => {
    const entity = existingEntity()
    const em = makeEm(entity)
    let caught: unknown
    try {
      await saveUserPerspective(em as never, null, {
        scope,
        tableId: 'customers',
        input: { name: 'My View', settings: { pageSize: 50 }, createOnly: true },
        request,
      })
    } catch (err) {
      caught = err
    }
    expectConflict(caught)
    expect((caught as { body: { code?: string } }).body.code).toBe('duplicate_name')
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(entity.settingsJson).toEqual({ original: true })
    expect(entity.updatedAt).toEqual(new Date(CURRENT_VERSION))
  })

  it('creates a new view on a create-only save when no active view has that name', async () => {
    const em = makeEm(null)
    const saved = await saveUserPerspective(em as never, null, {
      scope,
      tableId: 'customers',
      input: { name: 'My View', settings: { pageSize: 50 }, createOnly: true },
      request,
    })
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalled()
    expect(saved.name).toBe('My View')
  })

  it('keeps updating a name-matched view in place when createOnly is not set', async () => {
    const entity = existingEntity()
    const em = makeEm(entity)
    const saved = await saveUserPerspective(em as never, null, {
      scope,
      tableId: 'customers',
      input: { name: 'My View', settings: { pageSize: 50 } },
      request,
    })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(saved.id).toBe(PERSPECTIVE_ID)
    expect(entity.settingsJson).toEqual({ pageSize: 50 })
  })
})


it('rejects an unmatched id before any mutation using the complete personal scope', async () => {
  const em = makeEm(null)
  await expect(saveUserPerspective(em as never, null, {
    scope,
    tableId: 'customers',
    input: { perspectiveId: PERSPECTIVE_ID, name: 'Rejected', settings: { pageSize: 90 } },
    request,
  })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
    id: PERSPECTIVE_ID, userId: scope.userId, tenantId: scope.tenantId,
    organizationId: scope.organizationId, tableId: 'customers', deletedAt: null,
  })
  expect(em.create).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
  expect(em.nativeUpdate).not.toHaveBeenCalled()
})
