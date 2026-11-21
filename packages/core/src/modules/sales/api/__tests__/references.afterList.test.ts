/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesPayment } from '../../data/entities'
import { enrichShipmentListResponse } from '../shipments/route'
import '../payments/route'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({ makeCrudRoute: jest.fn(() => ({})) }))
jest.mock('#generated/entities/sales_shipment', () => ({}), { virtual: true })
jest.mock('#generated/entities/sales_payment', () => ({}), { virtual: true })
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: EntityManager, entity: never, where: never) => em.find(entity, where),
}))

type Payload = { items: Record<string, unknown>[] }
type Enrich = (payload: Payload, ctx: CrudCtx) => Promise<void>
type RouteConfig = { orm: { entity: unknown }; hooks: { afterList: Enrich } }

const paymentConfig = (jest.mocked(makeCrudRoute).mock.calls as unknown as [RouteConfig][])
  .find(([config]) => config.orm.entity === SalesPayment)![0]

function setup(tenantId: string, organizationId: string, overrides: Partial<CrudCtx> = {}) {
  const find = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    const organization = where.organizationId
    const allowed = typeof organization === 'object' && organization !== null
      ? (organization as { $in: string[] }).$in.includes(organizationId)
      : organization === undefined || organization === organizationId
    return (where.tenantId === undefined || where.tenantId === tenantId) && allowed
      ? [{ id: 'reference', tenantId, organizationId, value: 'private-status', label: 'Private status', name: 'Private method', code: 'PRIVATE' }]
      : []
  })
  const ctx = {
    container: { resolve: () => ({ find }) },
    auth: { tenantId: 'tenant-local', orgId: 'org-home' },
    selectedOrganizationId: 'org-selected', organizationIds: ['org-selected'], organizationScope: null,
    ...overrides,
  } as unknown as CrudCtx
  return { ctx, find }
}

describe.each([
  ['shipments', enrichShipmentListResponse, 'shipping_method'],
  ['payments', paymentConfig.hooks.afterList, 'payment_method'],
] as const)('%s list references', (_resource, enrich: Enrich, field) => {
  const payload = (): Payload => ({ items: [{ id: 'record', [`${field}_id`]: 'reference', status_entry_id: 'reference', status: null }] })

  it.each([
    ['tenant-foreign', 'org-selected'],
    ['tenant-local', 'org-foreign'],
  ])('does not disclose %s / %s reference metadata', async (tenantId, organizationId) => {
    const { ctx, find } = setup(tenantId, organizationId)
    const result = payload()
    await enrich(result, ctx)
    expect(result.items[0][`${field}_name`]).toBeUndefined()
    expect(result.items[0][`${field}_code`]).toBeUndefined()
    expect(result.items[0].status_label).toBeUndefined()
    expect(result.items[0].status).toBeNull()
    expect(find).toHaveBeenCalled()
    for (const [, where] of find.mock.calls) {
      expect(where).toMatchObject({ tenantId: 'tenant-local', organizationId: { $in: ['org-selected'] } })
    }
  })

  it('enriches references in the selected organization rather than the home organization', async () => {
    const { ctx } = setup('tenant-local', 'org-selected')
    const result = payload()
    await enrich(result, ctx)
    expect(result.items[0][`${field}_name`]).toBe('Private method')
    expect(result.items[0][`${field}_code`]).toBe('PRIVATE')
    expect(result.items[0].status_label).toBe('Private status')
  })

  it('preserves an explicit empty organization scope', async () => {
    const { ctx } = setup('tenant-local', 'org-selected', { organizationIds: [] })
    const result = payload()
    await enrich(result, ctx)
    expect(result.items[0].status_label).toBeUndefined()
    expect(result.items[0][`${field}_name`]).toBeUndefined()
  })

  it('supports an authorized all-organization view within the tenant', async () => {
    const { ctx, find } = setup('tenant-local', 'org-other', {
      organizationIds: null,
      selectedOrganizationId: null,
      organizationScope: { allowedIds: null } as CrudCtx['organizationScope'],
    })
    const result = payload()
    await enrich(result, ctx)
    expect(result.items[0].status_label).toBe('Private status')
    for (const [, where] of find.mock.calls) expect(where.tenantId).toBe('tenant-local')
  })

  it('does not query without an authenticated tenant', async () => {
    const { ctx, find } = setup('tenant-local', 'org-selected', { auth: null })
    await enrich(payload(), ctx)
    expect(find).not.toHaveBeenCalled()
  })
})
