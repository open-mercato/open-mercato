import { TenantEncryptionSubscriber } from '../subscriber'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// Regression coverage for issue #3672: an encrypted column declared as `type: 'json'`
// (e.g. inbox_ops:inbox_proposal_action.payload) round-trips through encryption as a
// JSON *string* — `decryptFields` intentionally never re-parses decrypted entity columns
// so that string/text columns whose contents look like JSON stay raw. The entity-hydration
// subscriber must restore json-typed columns back to objects/arrays, otherwise consumers
// (the proposal Edit dialog) read `payload.orderNumber` off a string and render blank fields.

function makeEm() {
  return { getComparator: () => undefined, getMetadata: () => undefined }
}

const META = {
  className: 'Thing',
  tableName: 'things',
  properties: {
    payload: { name: 'payload', type: 'json' },
    participants: { name: 'participants', type: 'json' },
    description: { name: 'description', type: 'text' },
  },
} as any

describe('TenantEncryptionSubscriber json-column restoration (issue #3672)', () => {
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
    decryptEntityPayload: (entityId: string, target: Record<string, unknown>) => Record<string, unknown>,
  ): TenantDataEncryptionService {
    return {
      isEnabled: () => true,
      async decryptEntityPayload(entityId: string, target: Record<string, unknown>) {
        return decryptEntityPayload(entityId, target)
      },
    } as unknown as TenantDataEncryptionService
  }

  it('parses decrypted json object columns back into objects', async () => {
    const entity: Record<string, unknown> = { tenantId: 't1', payload: 'enc:cipher' }
    const subscriber = new TenantEncryptionSubscriber(
      makeService(() => ({ payload: '{"orderId":"o-1","orderNumber":"SO-100","noteAdditions":["hi"]}' })),
    )

    await subscriber.decryptEntityGraph(entity, META, makeEm(), { syncOriginal: true })

    expect(entity.payload).toEqual({ orderId: 'o-1', orderNumber: 'SO-100', noteAdditions: ['hi'] })
  })

  it('parses decrypted json array columns back into arrays', async () => {
    const entity: Record<string, unknown> = { tenantId: 't1', participants: 'enc:cipher' }
    const subscriber = new TenantEncryptionSubscriber(
      makeService(() => ({ participants: '[{"name":"Ada"},{"name":"Bo"}]' })),
    )

    await subscriber.decryptEntityGraph(entity, META, makeEm(), { syncOriginal: true })

    expect(entity.participants).toEqual([{ name: 'Ada' }, { name: 'Bo' }])
  })

  it('leaves decrypted string/text columns untouched even when they look like JSON', async () => {
    const entity: Record<string, unknown> = { tenantId: 't1', description: 'enc:cipher' }
    const subscriber = new TenantEncryptionSubscriber(
      makeService(() => ({ description: '{"this":"is a display name, not json"}' })),
    )

    await subscriber.decryptEntityGraph(entity, META, makeEm(), { syncOriginal: true })

    expect(entity.description).toBe('{"this":"is a display name, not json"}')
  })

  it('leaves non-string json column values untouched', async () => {
    const alreadyObject = { orderNumber: 'SO-200' }
    const entity: Record<string, unknown> = { tenantId: 't1', payload: alreadyObject }
    const subscriber = new TenantEncryptionSubscriber(
      makeService((_id, target) => ({ payload: target.payload })),
    )

    await subscriber.decryptEntityGraph(entity, META, makeEm(), { syncOriginal: true })

    expect(entity.payload).toBe(alreadyObject)
  })
})
