/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (emInstance: { findOne: jest.Mock }, entity: unknown, filters: unknown) =>
    emInstance.findOne(entity, filters),
}))

const TENANT = 'tenant-1'
const ORG = 'org-1'

function createEm() {
  const persisted: unknown[] = []
  const em = {
    persisted,
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => {
      const record = { id: 'assignment-new', ...payload }
      persisted.push(record)
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: ReturnType<typeof createEm>) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

describe('wms sales order warehouse assignment commands', () => {
  beforeAll(async () => {
    await import('../sales-order-assignment')
  })

  it('assigns a warehouse to a sales order', async () => {
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({
        id: 'warehouse-1',
        tenantId: TENANT,
        organizationId: ORG,
        isActive: true,
      })
      .mockResolvedValueOnce(null)

    const handler = commandRegistry.get('wms.sales-order.assign-warehouse')
    const result = await handler!.execute!(
      {
        salesOrderId: 'order-1',
        warehouseId: 'warehouse-1',
        tenantId: TENANT,
        organizationId: ORG,
      },
      createCtx(em),
    )

    expect(result).toEqual({
      assignmentId: 'assignment-new',
      warehouseId: 'warehouse-1',
    })
    expect(em.create).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('soft-deletes an explicit assignment on unassign', async () => {
    const em = createEm()
    const existing = {
      id: 'assignment-1',
      salesOrderId: 'order-1',
      warehouse: { id: 'warehouse-1' },
      deletedAt: null as Date | null,
    }
    em.findOne.mockResolvedValue(existing)

    const handler = commandRegistry.get('wms.sales-order.unassign-warehouse')
    const result = await handler!.execute!(
      {
        salesOrderId: 'order-1',
        tenantId: TENANT,
        organizationId: ORG,
      },
      createCtx(em),
    )

    expect(result).toEqual({ ok: true })
    expect(existing.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
  })
})
