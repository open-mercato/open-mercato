/** @jest-environment node */

import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999'
const USER = '33333333-3333-4333-8333-333333333333'
const OVERRIDE_VERSION = new Date('2026-07-16T10:00:00.000Z')

const authState: { auth: { sub: string; tenantId: string; orgId?: string | null } | null } = {
  auth: { sub: USER, tenantId: TENANT, orgId: null },
}

const em = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
  flush: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
  dispose: jest.fn(async () => {}),
}

const codeTypes: Record<string, { type: string; channels?: string[]; nonOptOut?: boolean }> = {
  'a.builtin': { type: 'a.builtin', channels: ['in_app', 'email'] },
  'a.unrestricted': { type: 'a.unrestricted' },
}

const runGuardedNotificationWriteMock = jest.fn(
  async (
    _container: unknown,
    _scope: unknown,
    _req: unknown,
    _options: unknown,
    write: () => Promise<unknown>,
  ) => ({ ok: true, result: await write() }),
)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authState.auth),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }) }),
}))

jest.mock('../../../lib/notification-type-registry', () => ({
  syncNotificationTypes: jest.fn(async () => ({ created: 0, updated: 0, deleted: 0 })),
  getNotificationType: (id: string) => codeTypes[id],
}))

jest.mock('../../../lib/routeHelpers', () => {
  const { isCrudHttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
  return {
    NOTIFICATION_SETTINGS_RESOURCE_KIND: 'notifications.settings',
    notificationCrudErrorResponse: (error: unknown) =>
      isCrudHttpError(error)
        ? Response.json((error as { body: unknown }).body ?? {}, { status: (error as { status: number }).status })
        : null,
    runGuardedNotificationWrite: (...args: never[]) => runGuardedNotificationWriteMock(...args),
  }
})

import { GET, PATCH } from '../route'
import { NotificationType, NotificationTypeOverride } from '../../../data/entities'

function typeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a.builtin',
    tenantId: null,
    labelKey: 'a.builtin.label',
    descriptionKey: null,
    category: null,
    silent: false,
    nonOptOut: false,
    ...overrides,
  }
}

function overrideRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ov-1',
    tenantId: TENANT,
    notificationTypeId: 'a.builtin',
    channels: ['in_app', 'email', 'push'] as string[] | null,
    nonOptOut: null as boolean | null,
    updatedAt: OVERRIDE_VERSION,
    ...overrides,
  }
}

function getRequest(): Request {
  return new Request('https://example.test/api/notifications/types')
}

function patchRequest(body: unknown, expectedVersion?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (expectedVersion) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expectedVersion)
  return new Request('https://example.test/api/notifications/types', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  authState.auth = { sub: USER, tenantId: TENANT, orgId: null }
  process.env.OM_OPTIMISTIC_LOCK = 'all'
  em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
  runGuardedNotificationWriteMock.mockImplementation(
    async (_c: unknown, _s: unknown, _r: unknown, _o: unknown, write: () => Promise<unknown>) => ({
      ok: true,
      result: await write(),
    }),
  )
})

describe('GET /api/notifications/types', () => {
  it('401s without an authenticated tenant', async () => {
    authState.auth = null
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('merges the caller tenant\'s stored overrides into the catalogue items', async () => {
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === NotificationType) {
        return [typeRow(), typeRow({ id: 'a.unrestricted', labelKey: 'a.unrestricted.label' })]
      }
      if (entity === NotificationTypeOverride) {
        return [overrideRow()]
      }
      throw new Error('unexpected find')
    })
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Array<Record<string, unknown>> }

    const overridden = body.items.find((item) => item.id === 'a.builtin')!
    expect(overridden.channels).toEqual(['in_app', 'email', 'push'])
    expect(overridden.storedChannels).toEqual(['in_app', 'email', 'push'])
    expect(overridden.updatedAt).toBe(OVERRIDE_VERSION.toISOString())

    const untouched = body.items.find((item) => item.id === 'a.unrestricted')!
    expect(untouched.channels).toBeNull()
    expect(untouched.storedChannels).toBeNull()
    expect(untouched.storedNonOptOut).toBeNull()
    expect(untouched.updatedAt).toBeNull()
  })

  it('scopes the override lookup to the caller tenant', async () => {
    em.find.mockImplementation(async (entity: unknown) => (entity === NotificationType ? [typeRow()] : []))
    await GET(getRequest())
    const overrideFind = em.find.mock.calls.find(([entity]) => entity === NotificationTypeOverride)!
    expect(overrideFind[1]).toMatchObject({ tenantId: TENANT })
  })

  it('falls back to the code-declared channels when the tenant stores no override', async () => {
    em.find.mockImplementation(async (entity: unknown) => (entity === NotificationType ? [typeRow()] : []))
    const response = await GET(getRequest())
    const body = (await response.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]!.channels).toEqual(['in_app', 'email'])
    expect(body.items[0]!.storedChannels).toBeNull()
  })

  it('a stored nonOptOut override wins over the mirrored code flag', async () => {
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === NotificationType) return [typeRow({ nonOptOut: true })]
      return [overrideRow({ channels: null, nonOptOut: false })]
    })
    const response = await GET(getRequest())
    const body = (await response.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]!.nonOptOut).toBe(false)
    expect(body.items[0]!.storedNonOptOut).toBe(false)
  })
})

describe('PATCH /api/notifications/types', () => {
  it('401s without an authenticated tenant', async () => {
    authState.auth = null
    const response = await PATCH(patchRequest({ id: 'a.builtin', channels: ['in_app'] }))
    expect(response.status).toBe(401)
  })

  it('400s on malformed JSON', async () => {
    const request = new Request('https://example.test/api/notifications/types', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const response = await PATCH(request)
    expect(response.status).toBe(400)
  })

  it('400s when neither channels nor nonOptOut is provided', async () => {
    const response = await PATCH(patchRequest({ id: 'a.builtin' }))
    expect(response.status).toBe(400)
  })

  it('404s for an unknown type', async () => {
    em.findOne.mockResolvedValue(null)
    const response = await PATCH(patchRequest({ id: 'nope', channels: ['in_app'] }))
    expect(response.status).toBe(404)
    expect(em.findOne).toHaveBeenCalledWith(NotificationType, {
      id: 'nope',
      $or: [{ tenantId: null }, { tenantId: TENANT }],
    })
  })

  it('resolves tenant-defined types too (not only system-wide rows)', async () => {
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === NotificationType ? typeRow({ id: 't.custom', tenantId: TENANT }) : null,
    )
    const response = await PATCH(patchRequest({ id: 't.custom', channels: ['in_app'] }))
    expect(response.status).toBe(200)
  })

  it('creates a tenant-scoped override row on first save', async () => {
    em.findOne.mockImplementation(async (entity: unknown) => (entity === NotificationType ? typeRow() : null))
    const response = await PATCH(patchRequest({ id: 'a.builtin', channels: ['in_app', 'email', 'push'] }))
    expect(response.status).toBe(200)
    expect(em.create).toHaveBeenCalledWith(NotificationTypeOverride, {
      tenantId: TENANT,
      notificationTypeId: 'a.builtin',
      channels: ['in_app', 'email', 'push'],
      nonOptOut: null,
    })
    expect(em.flush).toHaveBeenCalled()
    const body = (await response.json()) as { ok: boolean; item: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.item.channels).toEqual(['in_app', 'email', 'push'])
    expect(body.item.storedChannels).toEqual(['in_app', 'email', 'push'])
  })

  it('updates the existing override row and leaves the untouched field intact', async () => {
    const existing = overrideRow({ channels: ['in_app'], nonOptOut: true })
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === NotificationType ? typeRow() : existing,
    )
    const response = await PATCH(patchRequest({ id: 'a.builtin', channels: ['in_app', 'push'] }))
    expect(response.status).toBe(200)
    expect(existing.channels).toEqual(['in_app', 'push'])
    expect(existing.nonOptOut).toBe(true)
    expect(em.create).not.toHaveBeenCalled()
    const body = (await response.json()) as { item: Record<string, unknown> }
    expect(body.item.nonOptOut).toBe(true)
    expect(body.item.storedNonOptOut).toBe(true)
  })

  it('clearing both overrides removes the row and the code declarations apply again', async () => {
    const existing = overrideRow({ channels: ['in_app'], nonOptOut: null })
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === NotificationType ? typeRow() : existing,
    )
    const response = await PATCH(patchRequest({ id: 'a.builtin', channels: null }))
    expect(response.status).toBe(200)
    expect(em.remove).toHaveBeenCalledWith(existing)
    const body = (await response.json()) as { item: Record<string, unknown> }
    expect(body.item.channels).toEqual(['in_app', 'email'])
    expect(body.item.storedChannels).toBeNull()
    expect(body.item.updatedAt).toBeNull()
  })

  it('clearing only channels keeps the row while a nonOptOut override remains', async () => {
    const existing = overrideRow({ channels: ['in_app'], nonOptOut: false })
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === NotificationType ? typeRow() : existing,
    )
    const response = await PATCH(patchRequest({ id: 'a.builtin', channels: null }))
    expect(response.status).toBe(200)
    expect(em.remove).not.toHaveBeenCalled()
    expect(existing.channels).toBeNull()
    expect(existing.nonOptOut).toBe(false)
  })

  it('409s a stale write (expected version behind the stored override)', async () => {
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === NotificationType ? typeRow() : overrideRow(),
    )
    const response = await PATCH(
      patchRequest({ id: 'a.builtin', channels: ['in_app'] }, '2026-07-16T09:00:00.000Z'),
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('accepts a write whose expected version matches the stored override', async () => {
    const existing = overrideRow()
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === NotificationType ? typeRow() : existing,
    )
    const response = await PATCH(
      patchRequest({ id: 'a.builtin', channels: ['in_app'] }, OVERRIDE_VERSION.toISOString()),
    )
    expect(response.status).toBe(200)
    expect(existing.channels).toEqual(['in_app'])
  })

  it('first save is never lock-blocked (no stored version to conflict with)', async () => {
    em.findOne.mockImplementation(async (entity: unknown) => (entity === NotificationType ? typeRow() : null))
    const response = await PATCH(
      patchRequest({ id: 'a.builtin', channels: ['in_app'] }, '2026-07-16T09:00:00.000Z'),
    )
    expect(response.status).toBe(200)
  })

  it('runs the write through the mutation guard with the caller scope', async () => {
    em.findOne.mockImplementation(async (entity: unknown) => (entity === NotificationType ? typeRow() : null))
    await PATCH(patchRequest({ id: 'a.builtin', nonOptOut: true }))
    expect(runGuardedNotificationWriteMock).toHaveBeenCalledTimes(1)
    const [, scope, , options] = runGuardedNotificationWriteMock.mock.calls[0] as unknown[] as [
      unknown,
      { tenantId: string; userId: string },
      unknown,
      { resourceKind: string; operation: string },
    ]
    expect(scope.tenantId).toBe(TENANT)
    expect(scope.userId).toBe(USER)
    expect(options.resourceKind).toBe('notifications.settings')
    expect(options.operation).toBe('update')
  })

  it('returns a generic 500 (no internal error message leak) when the write throws', async () => {
    em.findOne.mockImplementation(async (entity: unknown) => (entity === NotificationType ? typeRow() : null))
    em.flush.mockRejectedValue(new Error('duplicate key value violates unique constraint "pg_secret"'))
    const response = await PATCH(patchRequest({ id: 'a.builtin', channels: ['in_app'] }))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('Internal error')
    expect(body.error).not.toContain('pg_secret')
  })
})
