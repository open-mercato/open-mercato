import type { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({})),
}))

import '../orders/route'
import '../quotes/route'

type RouteConfig = {
  list: {
    schema: z.ZodType<Record<string, unknown>>
    buildFilters: (query: Record<string, unknown>, ctx: CrudCtx) => Promise<Record<string, unknown>>
  }
}

const organizationId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const recordId = '33333333-3333-4333-8333-333333333333'
const routes = (jest.mocked(makeCrudRoute).mock.calls as unknown as [RouteConfig][])

const context = {
  auth: { tenantId, orgId: organizationId },
  selectedOrganizationId: organizationId,
  organizationIds: [organizationId, '44444444-4444-4444-8444-444444444444'],
  container: { resolve: jest.fn() },
} as unknown as CrudCtx

describe('sales exact organization owner reads (#7780)', () => {
  it('registers every built-in owner route', () => {
    expect(routes).toHaveLength(2)
  })

  it.each(routes.map(([config], index) => [index, config] as const))('narrows owner route %s before pagination without changing caller scope', async (_index, config) => {
    const query = config.list.schema.parse({ id: recordId, exactOrganizationId: organizationId, exactTenantId: tenantId })
    const filters = await config.list.buildFilters(query, context)
    expect(filters).toMatchObject({
      organization_id: { $eq: organizationId },
      tenant_id: { $eq: tenantId },
      id: { $eq: recordId },
    })
    expect(context.organizationIds).toHaveLength(2)
    expect(context.auth?.tenantId).toBe(tenantId)
  })

  it.each(routes.map(([config], index) => [index, config] as const))('preserves unqualified owner route %s and validates exact UUIDs', async (_index, config) => {
    const filters = await config.list.buildFilters(config.list.schema.parse({ id: recordId }), context)
    expect(filters).not.toHaveProperty('organization_id')
    expect(filters).not.toHaveProperty('tenant_id')
    expect(config.list.schema.safeParse({ exactOrganizationId: 'invalid' }).success).toBe(false)
    expect(config.list.schema.safeParse({ exactTenantId: 'invalid' }).success).toBe(false)
  })
})
