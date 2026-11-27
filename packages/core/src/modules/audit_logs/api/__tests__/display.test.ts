/** @jest-environment node */
import { loadAuditLogDisplayMaps } from '@open-mercato/core/modules/audit_logs/api/audit-logs/display'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { registerEntityIds, getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'

function makeEm(overrides: { users?: any[]; apiKeys?: any[]; tenants?: any[]; organizations?: any[] } = {}) {
  const users = overrides.users ?? []
  const apiKeys = overrides.apiKeys ?? []
  const tenants = overrides.tenants ?? []
  const organizations = overrides.organizations ?? []
  return {
    find: jest.fn(async (entity: unknown) => {
      if (entity === User) return users
      if (entity === ApiKey) return apiKeys
      if (entity === Tenant) return tenants
      if (entity === Organization) return organizations
      return []
    }),
  } as any
}

const legacyEntry = (actorUserId: string) => ({
  id: actorUserId,
  actorUserId,
  contextJson: null,
  tenantId: null,
  organizationId: null,
})

const fallbackTranslate: TranslateWithFallbackFn = (_key, fallback, params) => {
  if (!fallback) return _key
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (match, key) => (params[key] !== undefined ? String(params[key]) : match))
}

describe('loadAuditLogDisplayMaps', () => {
  // The api_keys module is optional: an app can register entity ids without it
  // (see module-decoupling.test.ts), in which case ApiKey has no ORM metadata
  // and `em.find(ApiKey, ...)` would throw. This suite owns its own snapshot of
  // the process-global entity id registry instead of relying on whatever the
  // surrounding run happens to have registered.
  let previousEntityIds: EntityIds | null = null

  beforeEach(() => {
    previousEntityIds = getEntityIds(false)
    registerEntityIds({ api_keys: { api_key: 'api_keys:api_key' } })
  })

  afterEach(() => {
    registerEntityIds(previousEntityIds ?? ({} as EntityIds))
    previousEntityIds = null
  })

  it('resolves a user actor id without querying api_keys', async () => {
    const em = makeEm({ users: [{ id: 'user-1', name: 'Alice', email: 'alice@example.com' }] })

    const maps = await loadAuditLogDisplayMaps(em, [legacyEntry('user-1')])

    expect(maps.actors).toEqual({ 'user-1': 'Alice' })
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('labels an actor id that only matches an active api key', async () => {
    const em = makeEm({
      users: [],
      apiKeys: [{ id: 'key-1', name: 'import', deletedAt: null }],
    })

    const maps = await loadAuditLogDisplayMaps(em, [legacyEntry('key-1')])

    expect(maps.actors['key-1']).toBe('API key: import')
  })

  it('labels an actor id that matches a revoked (soft-deleted) api key', async () => {
    const em = makeEm({
      users: [],
      apiKeys: [{ id: 'key-2', name: 'legacy-import', deletedAt: new Date('2024-01-01T00:00:00.000Z') }],
    })

    const maps = await loadAuditLogDisplayMaps(em, [legacyEntry('key-2')])

    expect(maps.actors['key-2']).toBe('API key: legacy-import (revoked)')
  })

  it('never returns the raw id when neither a user nor an api key matches', async () => {
    const em = makeEm({ users: [], apiKeys: [] })

    const maps = await loadAuditLogDisplayMaps(em, [legacyEntry('ghost-id')])

    expect(maps.actors['ghost-id']).toBeUndefined()
  })

  it('does not query api_keys for a canonical user or a deleted legacy user', async () => {
    const deletedId = '11111111-1111-4111-8111-111111111111'
    const removedId = '22222222-2222-4222-8222-222222222222'
    const em = makeEm({
      users: [{ id: deletedId, name: 'Deleted account', deletedAt: new Date() }],
      apiKeys: [{ id: removedId, name: 'Unrelated key' }],
    })

    const maps = await loadAuditLogDisplayMaps(em, [
      legacyEntry(deletedId),
      { ...legacyEntry(removedId), contextJson: { actorSubject: removedId } },
    ])

    expect(maps.actors).toEqual({})
    expect(em.find).not.toHaveBeenCalledWith(ApiKey, expect.anything(), expect.anything())
  })

  it('keeps API-key labels distinct from user labels even when their IDs match', async () => {
    const actorId = '33333333-3333-4333-8333-333333333333'
    const tenantId = '44444444-4444-4444-8444-444444444444'
    const organizationId = '55555555-5555-4555-8555-555555555555'
    const em = makeEm({
      users: [{ id: actorId, name: 'Alice' }],
      apiKeys: [{ id: actorId, name: 'import', deletedAt: new Date(), tenantId, organizationId }],
    })
    const scoped = { ...legacyEntry(actorId), tenantId, organizationId }

    const maps = await loadAuditLogDisplayMaps(em, [
      { ...scoped, id: 'user-log', contextJson: { actorSubject: actorId } },
      { ...scoped, id: 'key-log', contextJson: { actorSubject: `api_key:${actorId}` } },
      { ...scoped, id: 'other-org-log', organizationId: null, contextJson: { actorSubject: `api_key:${actorId}` } },
      { ...scoped, id: 'other-tenant-log', tenantId: null, contextJson: { actorSubject: `api_key:${actorId}` } },
      { ...scoped, id: 'invalid-log', contextJson: { actorSubject: `api_key:${tenantId}` } },
    ])

    expect(maps.actors).toEqual({
      'user-log': 'Alice',
      'key-log': 'API key: import (revoked)',
    })
  })

  it('localizes the api key labels when a translate function is supplied', async () => {
    const em = makeEm({
      users: [],
      apiKeys: [
        { id: 'key-1', name: 'import', deletedAt: null },
        { id: 'key-2', name: 'legacy-import', deletedAt: new Date('2024-01-01T00:00:00.000Z') },
      ],
    })
    const translate = jest.fn(fallbackTranslate)

    const maps = await loadAuditLogDisplayMaps(
      em,
      [legacyEntry('key-1'), legacyEntry('key-2')],
      { translate },
    )

    expect(maps.actors['key-1']).toBe('API key: import')
    expect(maps.actors['key-2']).toBe('API key: legacy-import (revoked)')
    expect(translate).toHaveBeenCalledWith('audit_logs.actor.api_key', 'API key: {name}', { name: 'import' })
    expect(translate).toHaveBeenCalledWith(
      'audit_logs.actor.api_key_revoked',
      'API key: {name} (revoked)',
      { name: 'legacy-import' },
    )
  })

  it('skips the api_keys lookup entirely when the module is disabled', async () => {
    registerEntityIds({})
    const em = makeEm({ users: [], apiKeys: [{ id: 'key-1', name: 'import', deletedAt: null }] })

    const maps = await loadAuditLogDisplayMaps(em, [legacyEntry('key-1')])

    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.find).not.toHaveBeenCalledWith(ApiKey, expect.anything(), expect.anything())
    expect(maps.actors['key-1']).toBeUndefined()
  })
})
