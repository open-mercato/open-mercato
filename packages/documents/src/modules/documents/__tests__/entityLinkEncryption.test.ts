import { TenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { DocumentEntityLink } from '../data/entities'
import { defaultEncryptionMaps } from '../encryption'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const FOREIGN_TENANT_ID = '33333333-3333-4333-8333-333333333333'
const FOREIGN_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const LABEL = 'Acme renewal offer'
const FIXED_DEK: TenantDek = {
  tenantId: TENANT_ID,
  key: Buffer.alloc(32, 7).toString('base64'),
  fetchedAt: Date.parse('2026-07-10T00:00:00.000Z'),
}
const FOREIGN_DEK: TenantDek = {
  tenantId: FOREIGN_TENANT_ID,
  key: Buffer.alloc(32, 9).toString('base64'),
  fetchedAt: Date.parse('2026-07-10T00:00:00.000Z'),
}

function createEncryptionService(): TenantDataEncryptionService {
  const kms: KmsService = {
    isHealthy: () => true,
    getTenantDek: async (tenantId) => tenantId === TENANT_ID ? FIXED_DEK : FOREIGN_DEK,
    createTenantDek: async (tenantId) => tenantId === TENANT_ID ? FIXED_DEK : FOREIGN_DEK,
  }
  const service = new TenantDataEncryptionService({} as never, { kms })
  const map = defaultEncryptionMaps.find(
    (entry) => entry.entityId === 'documents:document_entity_link',
  )
  if (!map) throw new Error('[internal] DocumentEntityLink encryption map is missing')
  ;(service as unknown as {
    getMap: () => Promise<typeof map>
  }).getMap = async () => map
  return service
}

describe('DocumentEntityLink label encryption', () => {
  beforeAll(() => {
    registerEntityIds({
      documents: {
        document_entity_link: 'documents:document_entity_link',
      },
    })
  })

  it('turns label_snapshot into authenticated ciphertext before persistence', async () => {
    const service = createEncryptionService()
    const encrypted = await service.encryptEntityPayload(
      'documents:document_entity_link',
      {
        label_snapshot: LABEL,
        href_snapshot: '/backend/catalog/products/33333333-3333-4333-8333-333333333333',
      },
      TENANT_ID,
      ORGANIZATION_ID,
    )

    expect(encrypted.label_snapshot).not.toBe(LABEL)
    expect(String(encrypted.label_snapshot)).toMatch(/^[^:]+:[^:]+:[^:]+:v1$/)
    expect(encrypted.href_snapshot).toBe('/backend/catalog/products/33333333-3333-4333-8333-333333333333')

    await expect(service.decryptEntityPayload(
      'documents:document_entity_link',
      encrypted,
      TENANT_ID,
      ORGANIZATION_ID,
    )).resolves.toMatchObject({ label_snapshot: LABEL })

    const foreignTenantRead = await service.decryptEntityPayload(
      'documents:document_entity_link',
      encrypted,
      FOREIGN_TENANT_ID,
      ORGANIZATION_ID,
    )
    expect(foreignTenantRead.label_snapshot).toBe(encrypted.label_snapshot)
  })

  it('loads and decrypts only through the matching tenant and organization scope', async () => {
    const service = createEncryptionService()
    const encrypted = await service.encryptEntityPayload(
      'documents:document_entity_link',
      { label_snapshot: LABEL },
      TENANT_ID,
      ORGANIZATION_ID,
    )
    const stored = Object.assign(new DocumentEntityLink(), {
      id: '66666666-6666-4666-8666-666666666666',
      documentId: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      productId: '77777777-7777-4777-8777-777777777777',
      labelSnapshot: String(encrypted.label_snapshot),
      hrefSnapshot: '/backend/catalog/products/77777777-7777-4777-8777-777777777777',
      source: 'related-panel' as const,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      deletedAt: null,
    })
    const metadata = {
      className: 'DocumentEntityLink',
      tableName: 'document_entity_links',
      properties: {
        labelSnapshot: { name: 'labelSnapshot', fieldName: 'label_snapshot' },
      },
    }
    const find = jest.fn(async (_entity: unknown, where: unknown) => {
      const filter = where as {
        documentId: string
        tenantId: string
        organizationId: string
        deletedAt: null
      }
      return [stored].filter((row) => (
        row.documentId === filter.documentId
        && row.tenantId === filter.tenantId
        && row.organizationId === filter.organizationId
        && row.deletedAt === filter.deletedAt
      )).map((row) => Object.assign(new DocumentEntityLink(), row))
    })
    const em = {
      find,
      getMetadata: () => ({ find: () => metadata }),
    }
    const load = (tenantId: string, organizationId: string) => findWithDecryption(
      em as never,
      DocumentEntityLink,
      {
        documentId: DOCUMENT_ID,
        tenantId,
        organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId, organizationId, encryptionService: service },
    )

    await expect(load(FOREIGN_TENANT_ID, ORGANIZATION_ID)).resolves.toEqual([])
    await expect(load(TENANT_ID, FOREIGN_ORGANIZATION_ID)).resolves.toEqual([])
    await expect(load(TENANT_ID, ORGANIZATION_ID)).resolves.toEqual([
      expect.objectContaining({ labelSnapshot: LABEL }),
    ])
  })

  it('writes the encrypted label into the ORM change-set payload', async () => {
    const ciphertext = 'iv:ciphertext:tag:v1'
    const encryptEntityPayload = jest.fn(async (
      _entityId: string,
      payload: Record<string, unknown>,
    ) => ({ ...payload, labelSnapshot: ciphertext }))
    const service = {
      isEnabled: () => true,
      encryptEntityPayload,
    } as unknown as TenantDataEncryptionService
    const subscriber = new TenantEncryptionSubscriber(service)
    const entity = Object.assign(new DocumentEntityLink(), {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      labelSnapshot: LABEL,
      hrefSnapshot: '/backend/catalog/products/33333333-3333-4333-8333-333333333333',
    })
    const changeSet = {
      payload: {
        label_snapshot: LABEL,
        href_snapshot: entity.hrefSnapshot,
      },
    }
    const metadata = {
      className: 'DocumentEntityLink',
      tableName: 'document_entity_links',
      properties: {
        labelSnapshot: { name: 'labelSnapshot', fieldName: 'label_snapshot' },
        hrefSnapshot: { name: 'hrefSnapshot', fieldName: 'href_snapshot' },
      },
    }

    await subscriber.beforeCreate({
      entity,
      meta: metadata,
      em: {},
      changeSet,
    } as never)

    expect(encryptEntityPayload).toHaveBeenCalledWith(
      'documents:document_entity_link',
      entity,
      TENANT_ID,
      ORGANIZATION_ID,
    )
    expect(changeSet.payload.label_snapshot).toBe(ciphertext)
    expect(changeSet.payload.href_snapshot).toBe(entity.hrefSnapshot)
  })
})
