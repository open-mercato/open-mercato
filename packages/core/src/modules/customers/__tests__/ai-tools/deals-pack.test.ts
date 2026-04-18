/**
 * Step 3.9 — `customers.list_deals` / `customers.get_deal` unit tests.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
}))

import dealsAiTools from '../../ai-tools/deals-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = dealsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.list_deals', () => {
  const tool = findTool('customers.list_deals')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('declares existing RBAC features and has no isMutation flag', () => {
    expect(tool.requiredFeatures).toContain('customers.deals.view')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('rejects limit > 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })

  it('filters cross-tenant rows', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'd1', tenantId: 'tenant-1', organizationId: 'org-1', title: 'Deal A', createdAt: new Date('2024-01-01') },
      { id: 'd2', tenantId: 'tenant-2', organizationId: 'org-1', title: 'Cross tenant', createdAt: new Date('2024-01-02') },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['d1'])
  })

  it('returns empty page when personId yields zero matches', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    const ctx = makeCtx()
    const result = (await tool.handler(
      { personId: '3a7a73d6-999f-476a-81d6-26a467488635' },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.total).toBe(0)
    expect((result.items as unknown[]).length).toBe(0)
    expect(ctx.em.count).not.toHaveBeenCalled()
  })
})

describe('customers.get_deal', () => {
  const tool = findTool('customers.get_deal')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    loadCustomFieldValuesMock.mockResolvedValue({})
  })

  const dealId = '35dc2d65-6b3f-4846-a37f-a5ca7b89037c'

  it('returns { found: false } on miss (no throw)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({ dealId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('returns { found: false } when tenant mismatches', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: dealId,
      tenantId: 'tenant-2',
      organizationId: 'org-1',
      title: 'Leak',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ dealId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })
})
