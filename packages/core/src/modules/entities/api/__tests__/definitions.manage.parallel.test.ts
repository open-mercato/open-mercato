/** @jest-environment node */
import { GET } from '../definitions.manage'

const loadEntityFieldsetConfigsMock = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => (key === 'em' ? mockEm : null),
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    roles: ['admin'],
  }),
}))

jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({
  CustomFieldDef: 'CustomFieldDef',
}))

jest.mock('../../lib/fieldsets', () => ({
  loadEntityFieldsetConfigs: (...args: unknown[]) => loadEntityFieldsetConfigsMock(...args),
}))

describe('entities/definitions.manage GET (issue #1404)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('fetches defs, tombstones, and fieldset configs in parallel rather than sequentially', async () => {
    const calls: Array<{ id: string; start: number; end: number }> = []
    const slowResolve = <T>(id: string, value: T, delay: number): Promise<T> =>
      new Promise((resolve) => {
        const start = Date.now()
        setTimeout(() => {
          calls.push({ id, start, end: Date.now() })
          resolve(value)
        }, delay)
      })

    mockEm.find.mockImplementation((_entity: unknown, where: Record<string, unknown>) => {
      if (where && (where as any).deletedAt && typeof (where as any).deletedAt === 'object') {
        return slowResolve('tombstones', [], 60)
      }
      return slowResolve('defs', [], 60)
    })
    loadEntityFieldsetConfigsMock.mockImplementation(() => slowResolve('configs', new Map(), 60))

    const response = await GET(new Request('http://x/api/entities/definitions/manage?entityId=test:entity'))

    expect(response.status).toBe(200)
    expect(calls.map((c) => c.id).sort()).toEqual(['configs', 'defs', 'tombstones'])
    // All three legs should overlap in time, proving parallel execution.
    const earliestEnd = Math.min(...calls.map((c) => c.end))
    const latestStart = Math.max(...calls.map((c) => c.start))
    expect(latestStart).toBeLessThan(earliestEnd)
  })

  it('hides inherited definitions that are shadowed by a scoped tombstone', async () => {
    mockEm.find
      .mockResolvedValueOnce([
        {
          id: 'def-1',
          entityId: 'customers:customer_deal',
          key: 'estimated_seats',
          kind: 'integer',
          tenantId: 'tenant-1',
          organizationId: null,
          isActive: true,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          configJson: { label: 'Estimated seats' },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'def-2',
          entityId: 'customers:customer_deal',
          key: 'estimated_seats',
          kind: 'integer',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          isActive: false,
          deletedAt: new Date('2026-06-26T00:00:00.000Z'),
          updatedAt: new Date('2026-06-26T00:00:00.000Z'),
          configJson: { label: 'Estimated seats' },
        },
      ])
    loadEntityFieldsetConfigsMock.mockResolvedValueOnce(new Map())

    const response = await GET(new Request('http://x/api/entities/definitions.manage?entityId=customers:customer_deal'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toEqual([])
    expect(body.deletedKeys).toEqual(['estimated_seats'])
  })
})
