import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import type { VectorDriver, VectorDriverQueryResult } from '../vector/types'

function createHit(overrides: Partial<VectorDriverQueryResult> = {}): VectorDriverQueryResult {
  return {
    entityId: 'demo:item',
    recordId: 'record-1',
    organizationId: 'org-1',
    score: 0.9,
    checksum: 'checksum',
    resultTitle: 'sealed-title',
    primaryLinkHref: 'sealed-url',
    presenter: { title: 'sealed-presenter' },
    links: 'sealed-links' as unknown as VectorDriverQueryResult['links'],
    payload: 'sealed-payload' as unknown as VectorDriverQueryResult['payload'],
    ...overrides,
  }
}

function createStrategy(hits: VectorDriverQueryResult[], enabled = true) {
  const query = jest.fn(async () => hits)
  const driver: VectorDriver = {
    id: 'pgvector',
    supportsIndexDocFilter: true,
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    delete: async () => undefined,
    getChecksum: async () => null,
    query,
  }
  const decryptEntityPayload = jest.fn(async () => ({
    resultTitle: 'Visible title',
    resultSubtitle: 'Visible subtitle',
    resultIcon: 'user',
    primaryLinkHref: '/backend/demo/record-1',
    primaryLinkLabel: 'Open',
    links: JSON.stringify([{ href: '/backend/demo/record-1', label: 'Open', kind: 'primary' }]),
    payload: JSON.stringify({ public: true }),
  }))
  const encryptionService = { isEnabled: () => enabled, decryptEntityPayload } as unknown as TenantDataEncryptionService
  const strategy = new VectorSearchStrategy(
    { available: true, createEmbedding: async () => [0.1, 0.2] },
    driver,
    { encryptionService },
  )
  return { strategy, query, decryptEntityPayload }
}

describe('VectorSearchStrategy encrypted results', () => {
  it('decrypts and parses result fields before mapping links, presenter and metadata', async () => {
    const { strategy, decryptEntityPayload } = createStrategy([createHit()])
    const results = await strategy.search('anything', { tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(results).toEqual([expect.objectContaining({
      presenter: { title: 'Visible title', subtitle: 'Visible subtitle', icon: 'user' },
      url: '/backend/demo/record-1',
      links: [{ href: '/backend/demo/record-1', label: 'Open', kind: 'primary' }],
      metadata: { public: true },
    })])
    expect(JSON.stringify(results)).not.toContain('sealed-')
    expect(decryptEntityPayload).toHaveBeenCalledWith(
      'vector:vector_search', expect.objectContaining({ resultTitle: 'sealed-title' }), 'tenant-1', 'org-1',
    )
  })

  it('fails closed when decryption fails instead of returning raw encrypted results', async () => {
    const { strategy, decryptEntityPayload } = createStrategy([createHit({ links: null })])
    decryptEntityPayload.mockRejectedValueOnce(new Error('KMS unavailable'))

    await expect(strategy.search('anything', { tenantId: 'tenant-1' })).rejects.toThrow('KMS unavailable')
  })

  it('keeps tenant, organization, entity and index-document filters on the driver query', async () => {
    const { strategy, query, decryptEntityPayload } = createStrategy([
      createHit({ organizationId: 'org-2' }), createHit({ organizationId: null }),
    ])
    const indexDocFilter = { anyOf: [[{ op: 'eq' as const, key: 'is_active', value: true }]] }
    await strategy.search('anything', {
      tenantId: 'tenant-1', organizationIds: ['org-1', 'org-2'],
      entityTypes: ['demo:item'], indexDocFilter, limit: 5,
    })

    expect(query).toHaveBeenCalledWith({
      vector: [0.1, 0.2], limit: 5,
      filter: { tenantId: 'tenant-1', organizationIds: ['org-1', 'org-2'], entityIds: ['demo:item'], indexDocFilter },
    })
    expect(decryptEntityPayload.mock.calls.map((call) => call.slice(2))).toEqual([
      ['tenant-1', 'org-2'], ['tenant-1', null],
    ])
  })

  it('preserves plaintext driver results when encryption is disabled', async () => {
    const hit = createHit({ resultTitle: 'Plain title', presenter: { title: 'Plain title' }, primaryLinkHref: '/plain', links: null, payload: { public: true } })
    const { strategy, decryptEntityPayload } = createStrategy([hit], false)
    const results = await strategy.search('anything', { tenantId: 'tenant-1' })

    expect(results[0]).toMatchObject({ presenter: hit.presenter, url: '/plain', metadata: { public: true } })
    expect(decryptEntityPayload).not.toHaveBeenCalled()
  })
})
