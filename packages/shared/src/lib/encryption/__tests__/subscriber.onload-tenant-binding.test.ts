const warnMock = jest.fn()

jest.mock('../../logger', () => {
  const child = () => ({ debug: jest.fn(), info: jest.fn(), warn: warnMock, error: jest.fn(), child })
  return { createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: warnMock, error: jest.fn(), child }) }
})

jest.mock('../likeFilterWarning', () => ({ warnOnEncryptedLikeFilter: jest.fn(async () => undefined) }))

import { ReferenceKind } from '@mikro-orm/core'
import { TenantEncryptionSubscriber } from '../subscriber'
import { findAndCountWithDecryption, findOneWithDecryption, findWithDecryption } from '../find'
import { DECRYPT_REFUSAL_LOG_MESSAGE } from '../decryptScope'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// The ORM half of #5430 as it runs in production: `em.find` hydrates entities and fires the
// registered subscriber's `onLoad` BEFORE `find*WithDecryption` gets to apply the caller's scope.
// The fake EntityManager below mirrors that order, including an async gap before hydration, so a
// binding that only engages after `em.find` returns cannot pass.

const CHILD_META = { className: 'Child', tableName: 'children', properties: {} } as any

const LINK_META = {
  className: 'Link',
  tableName: 'links',
  properties: { child: { name: 'child', kind: ReferenceKind.MANY_TO_ONE } },
} as any

type Call = { entityId: string; tenantId: string | null }

function makeService(calls: Call[]): TenantDataEncryptionService {
  return {
    isEnabled: () => true,
    async decryptEntityPayload(entityId: string, target: Record<string, unknown>, tenantId: string | null) {
      calls.push({ entityId, tenantId })
      const value = target.secret
      if (typeof value === 'string' && value.startsWith('enc:')) return { secret: value.slice('enc:'.length) }
      return {}
    },
  } as unknown as TenantDataEncryptionService
}

function makeHydratingEm(subscriber: TenantEncryptionSubscriber, rows: Array<Record<string, unknown>>) {
  const hydrate = async () => {
    await new Promise((resolve) => setImmediate(resolve))
    for (const row of rows) {
      await subscriber.onLoad({ entity: row, meta: row.__meta, em } as any)
    }
  }
  const em = {
    getMetadata: () => undefined,
    getComparator: () => undefined,
    async find() {
      await hydrate()
      return rows
    },
    async findOne() {
      await hydrate()
      return rows[0] ?? null
    },
    async findAndCount() {
      await hydrate()
      return [rows, rows.length]
    },
  }
  return em
}

const refusalWarnings = () => warnMock.mock.calls.filter(([message]) => message === DECRYPT_REFUSAL_LOG_MESSAGE)

describe('find*WithDecryption tenant binding through the ORM onLoad hook (#5430)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    warnMock.mockClear()
    delete process.env.TENANT_DATA_ENCRYPTION
    registerEntityIds({ test: { child: 'test:child', link: 'test:link' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('refuses a foreign-tenant entity during hydration and reports the read once', async () => {
    const calls: Call[] = []
    const service = makeService(calls)
    const own = { id: 'own', secret: 'enc:alpha', tenantId: 'tenant-a', __meta: CHILD_META }
    const foreignOne = { id: 'f1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const foreignTwo = { id: 'f2', secret: 'enc:gamma', tenantId: 'tenant-b', __meta: CHILD_META }
    const em = makeHydratingEm(new TenantEncryptionSubscriber(service), [own, foreignOne, foreignTwo])

    await findWithDecryption(em as any, 'Child' as any, {}, undefined, {
      tenantId: 'tenant-a',
      organizationId: null,
      encryptionService: service,
    })

    expect(calls.every((call) => call.tenantId === 'tenant-a')).toBe(true)
    expect(own.secret).toBe('alpha')
    expect(foreignOne.secret).toBe('enc:beta')
    expect(foreignTwo.secret).toBe('enc:gamma')
    expect(refusalWarnings()).toHaveLength(1)
    expect(refusalWarnings()[0][1]).toMatchObject({ entity: 'test:child', refusedRows: 2, callerTenantId: 'tenant-a' })
  })

  it('applies the binding to findOne and findAndCount reads as well', async () => {
    const calls: Call[] = []
    const service = makeService(calls)
    const foreign = { id: 'f1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const subscriber = new TenantEncryptionSubscriber(service)
    const scope = { tenantId: 'tenant-a', organizationId: null, encryptionService: service }

    await findOneWithDecryption(makeHydratingEm(subscriber, [foreign]) as any, 'Child' as any, {}, undefined, scope)
    await findAndCountWithDecryption(makeHydratingEm(subscriber, [foreign]) as any, 'Child' as any, {}, undefined, scope)

    expect(calls).toEqual([])
    expect(foreign.secret).toBe('enc:beta')
  })

  it('keeps decrypting with the row tenant when the read asserts no tenant', async () => {
    const calls: Call[] = []
    const service = makeService(calls)
    const foreign = { id: 'f1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const em = makeHydratingEm(new TenantEncryptionSubscriber(service), [foreign])

    await findWithDecryption(em as any, 'Child' as any, {}, undefined, { encryptionService: service })

    expect(calls[0]).toEqual({ entityId: 'test:child', tenantId: 'tenant-b' })
    expect(foreign.secret).toBe('beta')
    expect(refusalWarnings()).toHaveLength(0)
  })

  it('does not hand an outer read scope to a nested read that asserts none', async () => {
    const calls: Call[] = []
    const service = makeService(calls)
    const subscriber = new TenantEncryptionSubscriber(service)
    const foreign = { id: 'f1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const outerEm = makeHydratingEm(subscriber, [])
    outerEm.find = async () => {
      await findWithDecryption(makeHydratingEm(subscriber, [foreign]) as any, 'Child' as any, {}, undefined, {
        encryptionService: service,
      })
      return []
    }

    await findWithDecryption(outerEm as any, 'Child' as any, {}, undefined, {
      tenantId: 'tenant-a',
      encryptionService: service,
    })

    expect(calls).toEqual([
      { entityId: 'test:child', tenantId: 'tenant-b' },
      { entityId: 'test:child', tenantId: 'tenant-b' },
    ])
    expect(foreign.secret).toBe('beta')
  })

  it('does not bind the caller scope outside the read that asserted it', async () => {
    const calls: Call[] = []
    const subscriber = new TenantEncryptionSubscriber(makeService(calls))
    const foreign = { id: 'f1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }

    await subscriber.onLoad({ entity: foreign, meta: CHILD_META, em: makeHydratingEm(subscriber, []) } as any)

    expect(calls).toEqual([{ entityId: 'test:child', tenantId: 'tenant-b' }])
    expect(foreign.secret).toBe('beta')
  })
})

describe('relation scope inherited from a tenant-less parent (#5430)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    warnMock.mockClear()
    delete process.env.TENANT_DATA_ENCRYPTION
    registerEntityIds({ test: { child: 'test:child', link: 'test:link' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('does not refuse a relation of a tenant-less parent against the caller tenant', async () => {
    const calls: Call[] = []
    const child = { id: 'c1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const link = { id: 'l1', child: { isInitialized: () => true, unwrap: () => child }, __meta: LINK_META }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(link, LINK_META, undefined, {
      syncOriginal: true,
      fallbackScope: { tenantId: 'tenant-a', organizationId: null },
    })

    expect(calls).toContainEqual({ entityId: 'test:child', tenantId: 'tenant-b' })
    expect(child.secret).toBe('beta')
    expect(refusalWarnings()).toHaveLength(0)
  })

  it('still keys a tenant-less relation of a tenant-less parent off the caller tenant', async () => {
    const calls: Call[] = []
    const child = { id: 'c1', secret: 'enc:beta', __meta: CHILD_META }
    const link = { id: 'l1', child: { isInitialized: () => true, unwrap: () => child }, __meta: LINK_META }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(link, LINK_META, undefined, {
      syncOriginal: true,
      fallbackScope: { tenantId: 'tenant-a', organizationId: null },
    })

    expect(calls).toContainEqual({ entityId: 'test:child', tenantId: 'tenant-a' })
    expect(child.secret).toBe('beta')
  })

  it('keeps binding a relation reached through a parent of the caller tenant', async () => {
    const calls: Call[] = []
    const child = { id: 'c1', secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const link = {
      id: 'l1',
      tenantId: 'tenant-a',
      child: { isInitialized: () => true, unwrap: () => child },
      __meta: LINK_META,
    }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(link, LINK_META, undefined, {
      syncOriginal: true,
      fallbackScope: { tenantId: 'tenant-a', organizationId: null },
    })

    expect(calls.some((call) => call.entityId === 'test:child')).toBe(false)
    expect(child.secret).toBe('enc:beta')
    expect(refusalWarnings()).toHaveLength(1)
  })
})
