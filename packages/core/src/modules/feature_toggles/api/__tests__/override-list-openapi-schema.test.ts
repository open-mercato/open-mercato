import { EntityManager } from '@mikro-orm/postgresql'
import { getOverrides } from '../../lib/queries'
import { FeatureToggle, FeatureToggleOverride } from '../../data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import {
  featureToggleOverrideSchema,
  featureToggleOverrideListResponseSchema,
} from '../openapi'

describe('feature toggle override list OpenAPI schema', () => {
  let em: EntityManager

  const tenant = { id: '11111111-1111-4111-8111-111111111111', name: 'Tenant 1' } as Tenant

  const overriddenToggle = {
    id: '22222222-2222-4222-8222-222222222222',
    identifier: 'toggle.overridden',
    name: 'Overridden Toggle',
    category: 'cat1',
    defaultValue: false,
    type: 'boolean',
    failMode: 'fail_closed',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as FeatureToggle

  const inheritedToggle = {
    id: '33333333-3333-4333-8333-333333333333',
    identifier: 'toggle.inherited',
    name: 'Inherited Toggle',
    category: 'cat2',
    defaultValue: false,
    type: 'boolean',
    failMode: 'fail_closed',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as FeatureToggle

  const override = {
    id: '44444444-4444-4444-8444-444444444444',
    toggle: { id: overriddenToggle.id },
    tenantId: tenant.id,
    value: undefined,
  } as unknown as FeatureToggleOverride

  beforeEach(() => {
    em = {
      find: jest.fn(),
    } as unknown as EntityManager
  })

  it('documents the live response shape for both override and inherited rows', async () => {
    (em.find as jest.Mock).mockResolvedValueOnce([overriddenToggle, inheritedToggle]);
    (em.find as jest.Mock).mockResolvedValueOnce([override])

    const result = await getOverrides(em, tenant, { page: 1, pageSize: 25 })

    const overrideRow = result.items.find((item) => item.toggleId === overriddenToggle.id)
    const inheritedRow = result.items.find((item) => item.toggleId === inheritedToggle.id)

    expect(overrideRow).toMatchObject({ id: override.id, isOverride: true })
    expect(inheritedRow).toMatchObject({ id: '', isOverride: false })

    // Each live row must validate against the documented OpenAPI row schema,
    // including the inherited empty-string `id` sentinel.
    for (const row of result.items) {
      expect(featureToggleOverrideSchema.safeParse(row).success).toBe(true)
    }

    const listResponse = {
      items: result.items,
      total: result.total,
      totalPages: result.totalPages,
      page: result.page,
      pageSize: result.pageSize,
      isSuperAdmin: false,
    }

    expect(featureToggleOverrideListResponseSchema.safeParse(listResponse).success).toBe(true)
  })

  it('rejects the previously documented but never-returned fields', () => {
    const staleRow = {
      id: '55555555-5555-4555-8555-555555555555',
      toggleId: '66666666-6666-4666-8666-666666666666',
      overrideState: 'enabled',
      defaultState: true,
      identifier: 'toggle.stale',
      name: 'Stale Toggle',
      category: 'cat3',
      tenantName: 'Tenant 1',
      tenantId: '11111111-1111-4111-8111-111111111111',
    }

    // The stale row omits the live `isOverride` field the schema now requires.
    expect(featureToggleOverrideSchema.safeParse(staleRow).success).toBe(false)
  })
})
