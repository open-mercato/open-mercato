/**
 * Step 3.10 — media / tags unit tests.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import mediaTagsAiTools from '../../ai-tools/media-tags-pack'
import { makeCtx } from './shared'

function findTool(name: string) {
  const tool = mediaTagsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_product_media', () => {
  const tool = findTool('catalog.list_product_media')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('scopes by catalog product entity id + product record id', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(0)
    await tool.handler({ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, ctx as any)
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.entityId).toBe('catalog:catalog_product')
    expect(whereArg.recordId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(whereArg.tenantId).toBe('tenant-1')
  })

  it('drops cross-tenant attachments', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'att-1', tenantId: 'tenant-1', organizationId: 'org-1', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 1, url: '/a', storageDriver: 'local', partitionCode: 'p', entityId: 'catalog:catalog_product', recordId: 'x' },
      { id: 'att-2', tenantId: 'tenant-2', organizationId: 'org-1', fileName: 'b.jpg', mimeType: 'image/jpeg', fileSize: 1, url: '/b', storageDriver: 'local', partitionCode: 'p', entityId: 'catalog:catalog_product', recordId: 'x' },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler(
      { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx as any,
    )) as Record<string, unknown>
    expect((result.items as any[]).map((r) => r.id)).toEqual(['att-1'])
  })
})

describe('catalog.list_product_tags', () => {
  const tool = findTool('catalog.list_product_tags')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('returns tag rows from populated assignments', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { tenantId: 'tenant-1', tag: { id: 't1', label: 'Hot', slug: 'hot' } },
      { tenantId: 'tenant-2', tag: { id: 't2', label: 'Leak', slug: 'leak' } },
    ])
    const ctx = makeCtx()
    const result = (await tool.handler(
      { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx as any,
    )) as Record<string, unknown>
    const labels = (result.items as any[]).map((r) => r.label)
    expect(labels).toEqual(['Hot'])
    expect(result.total).toBe(1)
  })
})
