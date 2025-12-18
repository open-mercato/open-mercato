import { VectorIndexService } from '../vector-index.service'

describe('VectorIndexService encryption scope', () => {
  test('uses organizationId from record when args.organizationId is null', async () => {
    const upsertCalls: any[] = []

    const driver = {
      id: 'pgvector',
      ensureReady: async () => undefined,
      getChecksum: async () => null,
      delete: async () => undefined,
      upsert: async (doc: any) => {
        upsertCalls.push(doc)
      },
      query: async () => [],
    }

    const encryptCalls: any[] = []
    const tenantEncryptionService = {
      isEnabled: () => true,
      encryptEntityPayload: async (entityId: string, payload: Record<string, unknown>, tenantId: string, organizationId: string | null) => {
        encryptCalls.push({ entityId, tenantId, organizationId, payload })
        return {
          ...payload,
          resultTitle: 'enc-title',
          payload: 'enc-payload',
          links: 'enc-links',
          primaryLinkLabel: 'enc-primary',
          resultSnapshot: 'enc-snapshot',
        }
      },
    }

    const service = new VectorIndexService({
      drivers: [driver as any],
      embeddingService: { available: true, createEmbedding: async () => [0.1, 0.2, 0.3] } as any,
      queryEngine: {
        query: async () => ({
          items: [
            {
              id: 'rec1',
              tenant_id: 't1',
              organization_id: 'org-from-record',
              display_name: 'Plain name',
            },
          ],
        }),
      } as any,
      moduleConfigs: [
        {
          id: 'example',
          entities: [
            {
              entityId: 'customers:customer_entity',
              buildSource: async () => ({ input: ['hello'], payload: { foo: 'bar' } }),
              formatResult: async () => ({ title: 'Plain title' }),
              resolveLinks: async () => [{ href: '/x', label: 'Plain label', kind: 'primary' }],
            },
          ],
        } as any,
      ],
      containerResolver: () => ({
        resolve: (name: string) => {
          if (name === 'tenantEncryptionService') return tenantEncryptionService
          throw new Error(`Unknown token: ${name}`)
        },
      }),
    })

    await service.indexRecord({
      entityId: 'customers:customer_entity',
      recordId: 'rec1',
      tenantId: 't1',
      organizationId: null,
    })

    expect(encryptCalls).toHaveLength(1)
    expect(encryptCalls[0].organizationId).toBe('org-from-record')
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].organizationId).toBe('org-from-record')
    expect(upsertCalls[0].payload).toBe('enc-payload')
    expect(upsertCalls[0].links).toBe('enc-links')
    expect(upsertCalls[0].primaryLinkLabel).toBe('enc-primary')
    expect(upsertCalls[0].resultSnapshot).toBe('enc-snapshot')
  })
})
