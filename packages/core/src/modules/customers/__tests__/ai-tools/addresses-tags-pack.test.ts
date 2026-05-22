/**
 * Step 3.9 — `customers.list_addresses` / `customers.list_tags` unit tests.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

import addressesTagsAiTools from '../../ai-tools/addresses-tags-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = addressesTagsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.list_addresses', () => {
  const tool = findTool('customers.list_addresses')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('declares existing RBAC features', () => {
    expect(tool.requiredFeatures!.length).toBeGreaterThan(0)
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('rejects limit > 100', () => {
    expect(tool.inputSchema.safeParse({ entityType: 'person', entityId: '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b', limit: 101 }).success).toBe(false)
  })

  it('filters cross-tenant rows', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'addr-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        addressLine1: '1 First Street',
        isPrimary: true,
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'addr-2',
        tenantId: 'tenant-2',
        organizationId: 'org-1',
        addressLine1: 'Cross tenant',
        isPrimary: false,
        createdAt: new Date('2024-01-02'),
      },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler(
      { entityType: 'person', entityId: '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b' },
      ctx as any,
    )) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['addr-1'])
  })
})

describe('customers.list_tags', () => {
  const tool = findTool('customers.list_tags')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('declares existing RBAC features', () => {
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
  })

  it('rejects limit > 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 500 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })

  it('filters cross-tenant rows', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 't1', tenantId: 'tenant-1', organizationId: 'org-1', slug: 'vip', label: 'VIP', color: '#fff', description: null },
      { id: 't2', tenantId: 'tenant-2', organizationId: 'org-1', slug: 'cross', label: 'Cross', color: null, description: null },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['t1'])
  })
})
