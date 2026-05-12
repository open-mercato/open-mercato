/**
 * Step 3.9 — `customers.get_settings` unit tests.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import settingsAiTools from '../../ai-tools/settings-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = settingsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.get_settings', () => {
  const tool = findTool('customers.get_settings')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
  })

  it('declares existing RBAC features and is read-only', () => {
    expect(tool.requiredFeatures).toContain('customers.settings.manage')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('rejects without tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('returns pipelines, stages, dictionaries grouped by kind, and addressFormat', async () => {
    findWithDecryptionMock
      .mockResolvedValueOnce([
        { id: 'pipe-1', tenantId: 'tenant-1', organizationId: 'org-1', name: 'Default', isDefault: true, createdAt: new Date('2024-01-01') },
      ])
      .mockResolvedValueOnce([
        { id: 'stg-1', tenantId: 'tenant-1', organizationId: 'org-1', pipelineId: 'pipe-1', label: 'New', order: 1 },
        { id: 'stg-2', tenantId: 'tenant-1', organizationId: 'org-1', pipelineId: 'pipe-1', label: 'Won', order: 10 },
      ])
      .mockResolvedValueOnce([
        { id: 'd-1', tenantId: 'tenant-1', organizationId: 'org-1', kind: 'status', value: 'Active', normalizedValue: 'active', label: 'Active', color: null, icon: null },
        { id: 'd-2', tenantId: 'tenant-1', organizationId: 'org-1', kind: 'source', value: 'Web', normalizedValue: 'web', label: 'Web', color: null, icon: null },
        { id: 'd-3', tenantId: 'tenant-2', organizationId: 'org-1', kind: 'source', value: 'Leak', normalizedValue: 'leak', label: 'Leak', color: null, icon: null },
      ])
    findOneWithDecryptionMock.mockResolvedValue({ addressFormat: 'street_first' })
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['pipelines', 'pipelineStages', 'dictionaries', 'addressFormat']))
    expect((result.pipelines as unknown[]).length).toBe(1)
    expect((result.pipelineStages as unknown[]).length).toBe(2)
    const dictionaries = result.dictionaries as Record<string, unknown[]>
    expect(Object.keys(dictionaries).sort()).toEqual(['source', 'status'])
    // cross-tenant leak was filtered out
    expect((dictionaries.source as unknown[]).length).toBe(1)
    expect(result.addressFormat).toBe('street_first')
  })

  it('falls back to line_first when no settings row exists', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(result.addressFormat).toBe('line_first')
  })
})
