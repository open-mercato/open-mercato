/**
 * Step 3.9 — `customers.list_activities` / `customers.list_tasks` unit tests.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

import activitiesTasksAiTools from '../../ai-tools/activities-tasks-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = activitiesTasksAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.list_activities', () => {
  const tool = findTool('customers.list_activities')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('declares existing RBAC features', () => {
    expect(tool.requiredFeatures).toContain('customers.activities.view')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('rejects limit > 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 150 }).success).toBe(false)
  })

  it('filters cross-tenant rows and passes scope correctly', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'a1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        activityType: 'call',
        subject: 'followup',
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'a2',
        tenantId: 'tenant-2',
        organizationId: 'org-1',
        activityType: 'call',
        subject: 'cross',
        createdAt: new Date('2024-01-02'),
      },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((item) => item.id)).toEqual(['a1'])
    expect(findWithDecryptionMock.mock.calls[0][2].tenantId).toBe('tenant-1')
  })
})

describe('customers.list_tasks', () => {
  const tool = findTool('customers.list_tasks')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('declares existing RBAC features', () => {
    expect(tool.requiredFeatures).toContain('customers.activities.view')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
  })

  it('rejects limit > 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 200 }).success).toBe(false)
  })

  it('merges interaction tasks and legacy todo links across tenants', async () => {
    findWithDecryptionMock
      .mockResolvedValueOnce([
        {
          id: 'i1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          interactionType: 'task',
          title: 'Call Alice',
          status: 'planned',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'i2',
          tenantId: 'tenant-2',
          organizationId: 'org-1',
          interactionType: 'task',
          title: 'cross',
          status: 'planned',
          createdAt: new Date('2024-01-01'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'l1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          todoId: 't1',
          todoSource: 'customers:interaction',
          createdAt: new Date('2024-01-02'),
        },
      ])
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['i1', 'l1'])
  })
})
