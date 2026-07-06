import { TenantEncryptionSubscriber } from '../subscriber'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// Regression coverage for issue #2498: the deep-decrypt re-baseline (syncOriginalEntityData) must
// NOT clear a managed entity's pending changes. When a command mutates an entity and then loads a
// related encrypted entity (whose deep-decrypt recurses back into the still-dirty entity) before
// the final flush, re-baselining the dirty entity silently dropped the pending write — the update
// command issued no UPDATE and `updated_at` never fired. The fix gates the re-baseline on the
// entity having no un-flushed changes (per MikroORM's own comparator).

type Helper = { __originalEntityData?: Record<string, unknown>; __touched?: boolean }

function makeComparator() {
  return {
    // Mirror MikroORM's prepared snapshot: a plain scalar copy of the entity.
    prepareEntity(entity: Record<string, unknown>) {
      const snapshot: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(entity)) {
        if (key === '__helper' || key === '__meta') continue
        snapshot[key] = value
      }
      return snapshot
    },
    // True when the two snapshots are identical (no pending changes). Order-independent, like
    // MikroORM's real comparator (the production fix depends on that property-wise semantics).
    matching(_entityName: string, a: Record<string, unknown>, b: Record<string, unknown>) {
      const aKeys = Object.keys(a)
      const bKeys = Object.keys(b)
      if (aKeys.length !== bKeys.length) return false
      return aKeys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
    },
  }
}

function makeEm() {
  const comparator = makeComparator()
  return { getComparator: () => comparator, getMetadata: () => undefined }
}

const META = { className: 'Thing', tableName: 'things', properties: {} } as any

describe('TenantEncryptionSubscriber change-tracking preservation (issue #2498)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION // default => encryption enabled
    registerEntityIds({ test: { thing: 'test:thing' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    jest.restoreAllMocks()
  })

  function makeService(
    decryptEntityPayload: (entityId: string, target: Record<string, unknown>) => Record<string, unknown> = () => ({}),
  ): TenantDataEncryptionService {
    return {
      isEnabled: () => true,
      async decryptEntityPayload(entityId: string, target: Record<string, unknown>) {
        return decryptEntityPayload(entityId, target)
      },
    } as unknown as TenantDataEncryptionService
  }

  it('preserves pending scalar changes when re-baselining a dirty managed entity', async () => {
    const helper: Helper = { __originalEntityData: { displayName: 'CHANGED', tenantId: 't1' }, __touched: true }
    // Command restored the value in-memory but has not flushed yet.
    const entity: Record<string, unknown> = { tenantId: 't1', displayName: 'Before', __helper: helper }

    const subscriber = new TenantEncryptionSubscriber(makeService())
    await subscriber.decryptEntityGraph(entity, META, makeEm(), { syncOriginal: true })

    // Baseline must still reflect the un-restored value so the flush computes a non-empty changeset.
    expect(helper.__originalEntityData).toEqual({ displayName: 'CHANGED', tenantId: 't1' })
    expect(helper.__touched).toBe(true)
  })

  it('still re-baselines a clean entity so decrypted values are not re-persisted', async () => {
    const helper: Helper = { __originalEntityData: { secret: 'enc:plain', tenantId: 't1' }, __touched: false }
    const entity: Record<string, unknown> = { tenantId: 't1', secret: 'enc:plain', __helper: helper }

    // Decrypt rewrites the ciphertext column to plaintext.
    const subscriber = new TenantEncryptionSubscriber(
      makeService(() => ({ secret: 'plain' })),
    )
    await subscriber.decryptEntityGraph(entity, META, makeEm(), { syncOriginal: true })

    // Clean entity: re-baseline must snapshot the decrypted value so the next flush sees no change.
    expect(entity.secret).toBe('plain')
    expect(helper.__originalEntityData).toEqual({ secret: 'plain', tenantId: 't1' })
    expect(helper.__touched).toBe(false)
  })
})
