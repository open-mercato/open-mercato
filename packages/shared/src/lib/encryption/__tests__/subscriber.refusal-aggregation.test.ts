const warnMock = jest.fn()

jest.mock('../../logger', () => {
  const child = () => ({ debug: jest.fn(), info: jest.fn(), warn: warnMock, error: jest.fn(), child })
  return { createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: warnMock, error: jest.fn(), child }) }
})

import { decryptEntitiesWithFallbackScope, TenantEncryptionSubscriber } from '../subscriber'
import { DECRYPT_REFUSAL_LOG_MESSAGE } from '../decryptScope'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// A mis-scoped `findWithDecryption` refuses its whole result list. The docs promise one aggregated
// warning per read; the ORM path used to emit one line per entity, so a page of 500 foreign rows
// produced 500 warnings.

const CHILD_META = { className: 'Child', tableName: 'children', properties: {} } as any

const makeEm = () => ({ getMetadata: () => undefined, getComparator: () => undefined })

const makeService = (): TenantDataEncryptionService =>
  ({
    isEnabled: () => true,
    async decryptEntityPayload(_entityId: string, target: Record<string, unknown>) {
      const value = target.secret
      if (typeof value === 'string' && value.startsWith('enc:')) return { secret: value.slice('enc:'.length) }
      return {}
    },
  }) as unknown as TenantDataEncryptionService

const refusalWarnings = () => warnMock.mock.calls.filter(([message]) => message === DECRYPT_REFUSAL_LOG_MESSAGE)

describe('ORM decrypt-refusal aggregation (#5430)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    warnMock.mockClear()
    delete process.env.TENANT_DATA_ENCRYPTION
    registerEntityIds({ test: { child: 'test:child' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('emits one warning for a whole refused batch, not one per entity', async () => {
    const entities = ['tenant-b', 'tenant-c', 'tenant-d', 'tenant-e'].map((tenantId, index) => ({
      id: `row-${index}`,
      secret: 'enc:alpha',
      tenantId,
      __meta: CHILD_META,
    }))

    await decryptEntitiesWithFallbackScope(entities, {
      em: makeEm() as any,
      tenantId: 'tenant-a',
      encryptionService: makeService(),
    })

    const warnings = refusalWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0][1]).toEqual({
      entity: 'test:child',
      refusedRows: 4,
      callerTenantId: 'tenant-a',
      rowTenantIds: ['tenant-b', 'tenant-c', 'tenant-d'],
    })
    for (const entity of entities) expect(entity.secret).toBe('enc:alpha')
  })

  it('emits no warning when the batch is correctly scoped', async () => {
    const entities = [
      { id: 'row-0', secret: 'enc:alpha', tenantId: 'tenant-a', __meta: CHILD_META },
      { id: 'row-1', secret: 'enc:beta', tenantId: 'tenant-a', __meta: CHILD_META },
    ]

    await decryptEntitiesWithFallbackScope(entities, {
      em: makeEm() as any,
      tenantId: 'tenant-a',
      encryptionService: makeService(),
    })

    expect(refusalWarnings()).toHaveLength(0)
    expect(entities.map((entity) => entity.secret)).toEqual(['alpha', 'beta'])
  })

  it('still reports immediately for a single-entity call that takes no tally', async () => {
    const entity = { id: 'row-0', secret: 'enc:alpha', tenantId: 'tenant-b', __meta: CHILD_META }

    await new TenantEncryptionSubscriber(makeService()).decryptEntityGraph(entity, CHILD_META, makeEm() as any, {
      syncOriginal: true,
      fallbackScope: { tenantId: 'tenant-a', organizationId: null },
    })

    const warnings = refusalWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0][1]).toEqual({
      entity: 'test:child',
      refusedRows: 1,
      callerTenantId: 'tenant-a',
      rowTenantIds: ['tenant-b'],
    })
  })
})
