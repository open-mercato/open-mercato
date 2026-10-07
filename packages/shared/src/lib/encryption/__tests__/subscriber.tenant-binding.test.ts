import { ReferenceKind } from '@mikro-orm/core'
import { TenantEncryptionSubscriber } from '../subscriber'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// Coverage for the ORM half of #5430. `findWithDecryption` passes the caller's scope as a fallback,
// but the entity's own tenant took precedence — so an entity from another tenant that reached a
// tenant-scoped read was decrypted with that other tenant's DEK. The subscriber now refuses it.

const CHILD_META = { className: 'Child', tableName: 'children', properties: {} } as any

const PARENT_META = {
  className: 'Parent',
  tableName: 'parents',
  properties: { child: { name: 'child', kind: ReferenceKind.MANY_TO_ONE } },
} as any

const makeEm = () => ({ getMetadata: () => undefined, getComparator: () => undefined })

function makeService(calls: Array<{ entityId: string; tenantId: string | null }>): TenantDataEncryptionService {
  return {
    isEnabled: () => true,
    async decryptEntityPayload(
      entityId: string,
      target: Record<string, unknown>,
      tenantId: string | null,
    ) {
      calls.push({ entityId, tenantId })
      const value = target.secret
      if (typeof value === 'string' && value.startsWith('enc:')) return { secret: value.slice('enc:'.length) }
      return {}
    },
  } as unknown as TenantDataEncryptionService
}

describe('TenantEncryptionSubscriber decrypt tenant binding (#5430)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION
    registerEntityIds({ test: { parent: 'test:parent', child: 'test:child' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    jest.restoreAllMocks()
  })

  it('leaves an entity untouched when its tenant contradicts the caller scope', async () => {
    const calls: Array<{ entityId: string; tenantId: string | null }> = []
    const entity = { secret: 'enc:alpha', tenantId: 'tenant-b', __meta: CHILD_META }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(
      entity,
      CHILD_META,
      makeEm() as any,
      { syncOriginal: true, fallbackScope: { tenantId: 'tenant-a', organizationId: null } },
    )

    expect(calls).toEqual([])
    expect(entity.secret).toBe('enc:alpha')
  })

  it('still decrypts an entity whose tenant matches the caller scope', async () => {
    const calls: Array<{ entityId: string; tenantId: string | null }> = []
    const entity = { secret: 'enc:alpha', tenantId: 'tenant-a', __meta: CHILD_META }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(
      entity,
      CHILD_META,
      makeEm() as any,
      { syncOriginal: true, fallbackScope: { tenantId: 'tenant-a', organizationId: null } },
    )

    expect(calls).toEqual([{ entityId: 'test:child', tenantId: 'tenant-a' }])
    expect(entity.secret).toBe('alpha')
  })

  it('still decrypts when the caller supplied no scope at all', async () => {
    const calls: Array<{ entityId: string; tenantId: string | null }> = []
    const entity = { secret: 'enc:alpha', tenantId: 'tenant-b', __meta: CHILD_META }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(
      entity,
      CHILD_META,
      makeEm() as any,
      { syncOriginal: true },
    )

    expect(calls).toEqual([{ entityId: 'test:child', tenantId: 'tenant-b' }])
    expect(entity.secret).toBe('alpha')
  })

  it('falls back to the caller tenant for an entity that carries none of its own', async () => {
    const calls: Array<{ entityId: string; tenantId: string | null }> = []
    const entity = { secret: 'enc:alpha', __meta: CHILD_META }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(
      entity,
      CHILD_META,
      makeEm() as any,
      { syncOriginal: true, fallbackScope: { tenantId: 'tenant-a', organizationId: null } },
    )

    expect(calls).toEqual([{ entityId: 'test:child', tenantId: 'tenant-a' }])
    expect(entity.secret).toBe('alpha')
  })

  it('does not leak a refused parent scope into its loaded relations', async () => {
    const calls: Array<{ entityId: string; tenantId: string | null }> = []
    const child = { secret: 'enc:beta', tenantId: 'tenant-b', __meta: CHILD_META }
    const parent = {
      secret: 'enc:alpha',
      tenantId: 'tenant-b',
      child: { isInitialized: () => true, unwrap: () => child },
      __meta: PARENT_META,
    }

    await new TenantEncryptionSubscriber(makeService(calls)).decryptEntityGraph(
      parent,
      PARENT_META,
      makeEm() as any,
      { syncOriginal: true, fallbackScope: { tenantId: 'tenant-a', organizationId: null } },
    )

    expect(calls).toEqual([])
    expect(parent.secret).toBe('enc:alpha')
    expect(child.secret).toBe('enc:beta')
  })
})
