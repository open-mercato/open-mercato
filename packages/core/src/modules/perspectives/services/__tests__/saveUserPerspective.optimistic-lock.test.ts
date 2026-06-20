/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { saveUserPerspective } from '../perspectiveService'

const PERSPECTIVE_ID = '123e4567-e89b-12d3-a456-426614174200'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
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

function requestWithHeader(headerValue?: string): Request {
  const headers: Record<string, string> = {}
  if (headerValue) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerValue
  return new Request('http://localhost/api/perspectives/customers', { method: 'POST', headers })
}

const scope = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const baseInput = { name: 'My View', settings: {} as Record<string, unknown> }

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
