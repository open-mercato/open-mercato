/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'

const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { resolveAllowedWidgetIds } from '../access'

type WidgetInput = { metadata: { id: string; features?: string[] } }

function widget(id: string, features?: string[]): WidgetInput {
  return { metadata: { id, ...(features ? { features } : {}) } }
}

const baseCtx = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  features: [] as string[],
  isSuperAdmin: false,
}

type EmStub = {
  findOne: jest.Mock
  find: jest.Mock
}

function makeEm(options: { userRecord?: unknown; roleRecords?: unknown[] }): EmStub {
  return {
    findOne: jest.fn(async () => options.userRecord ?? null),
    find: jest.fn(async () => options.roleRecords ?? []),
  }
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindWithDecryption.mockResolvedValue([])
})

describe('resolveAllowedWidgetIds', () => {
  test('non-empty user override wins and skips role-level lookups', async () => {
    const em = makeEm({ userRecord: { mode: 'override', widgetIdsJson: ['a', 'b'] } })
    const widgets = [widget('a'), widget('b'), widget('c')]

    const result = await resolveAllowedWidgetIds(em as unknown as EntityManager, baseCtx, widgets)

    expect(result).toEqual(['a', 'b'])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  test('empty user override returns no widgets without role lookups', async () => {
    const em = makeEm({ userRecord: { mode: 'override', widgetIdsJson: [] } })
    const widgets = [widget('a'), widget('b')]

    const result = await resolveAllowedWidgetIds(em as unknown as EntityManager, baseCtx, widgets)

    expect(result).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  test('feature gating still applies to a user override selection', async () => {
    const em = makeEm({ userRecord: { mode: 'override', widgetIdsJson: ['a', 'b'] } })
    const widgets = [widget('a'), widget('b', ['dashboards.secret'])]

    const result = await resolveAllowedWidgetIds(em as unknown as EntityManager, baseCtx, widgets)

    expect(result).toEqual(['a'])
    expect(em.find).not.toHaveBeenCalled()
  })

  test('inherited mode aggregates role widgets', async () => {
    mockFindWithDecryption.mockResolvedValue([{ role: { id: 'role-1' } }])
    const em = makeEm({
      userRecord: { mode: 'inherit', widgetIdsJson: ['a'] },
      roleRecords: [{ roleId: 'role-1', tenantId: null, organizationId: null, widgetIdsJson: ['b'] }],
    })
    const widgets = [widget('a'), widget('b'), widget('c')]

    const result = await resolveAllowedWidgetIds(em as unknown as EntityManager, baseCtx, widgets)

    expect(result).toEqual(['b'])
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  test('falls back to all widgets when there is no override and no role records', async () => {
    mockFindWithDecryption.mockResolvedValue([])
    const em = makeEm({ userRecord: null, roleRecords: [] })
    const widgets = [widget('a'), widget('b')]

    const result = await resolveAllowedWidgetIds(em as unknown as EntityManager, baseCtx, widgets)

    expect(result).toEqual(['a', 'b'])
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })
})
