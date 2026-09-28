/** @jest-environment node */

// Every Open Mercato app projects every entity type a write path names into
// `entity_indexes`, and until now nothing let an app say "not this one". These
// tests pin the resolution order of the switch that does: module declarations
// first, app `modules.ts` overrides on top, everything else projected.

const mockLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ child: () => mockLogger, ...mockLogger }),
}))

import {
  applyQueryIndexOverrides,
  filterProjectedEntityTypes,
  isEntityTypeProjected,
  listNonProjectedEntityTypes,
  registerQueryIndexModuleConfigs,
  resetQueryIndexProjectionPolicyForTests,
  type QueryIndexModuleConfig,
} from '../query-index'
import { registerSearchModuleConfigs } from '../search'

beforeEach(() => {
  resetQueryIndexProjectionPolicyForTests()
  registerSearchModuleConfigs([])
  mockLogger.warn.mockClear()
})

describe('query index projection policy', () => {
  it('projects every entity type when nothing is declared', () => {
    expect(isEntityTypeProjected('sales:sales_order')).toBe(true)
    expect(isEntityTypeProjected('sales:sales_order_line')).toBe(true)
    expect(listNonProjectedEntityTypes()).toEqual([])
  })

  it('honours a module declaration', () => {
    const config: QueryIndexModuleConfig = {
      entities: [
        { entityId: 'sales:sales_order_line', project: false },
        { entityId: 'sales:sales_order', project: true },
      ],
    }
    registerQueryIndexModuleConfigs([config])

    expect(isEntityTypeProjected('sales:sales_order_line')).toBe(false)
    expect(isEntityTypeProjected('sales:sales_order')).toBe(true)
    expect(listNonProjectedEntityTypes()).toEqual(['sales:sales_order_line'])
  })

  it('treats an entity declared without `project` as projected', () => {
    registerQueryIndexModuleConfigs([{ entities: [{ entityId: 'sales:sales_note' }] }])
    expect(isEntityTypeProjected('sales:sales_note')).toBe(true)
  })

  it('lets an app override the module that owns the entity, in both directions', () => {
    registerQueryIndexModuleConfigs([
      { entities: [{ entityId: 'sales:sales_note', project: true }, { entityId: 'sales:sales_payment', project: false }] },
    ])
    applyQueryIndexOverrides([
      { entities: { 'sales:sales_note': { project: false }, 'sales:sales_payment': { project: true } } },
    ])

    expect(isEntityTypeProjected('sales:sales_note')).toBe(false)
    expect(isEntityTypeProjected('sales:sales_payment')).toBe(true)
  })

  it('reads `null` as the shorthand for `{ project: false }`', () => {
    applyQueryIndexOverrides([{ entities: { 'sales:sales_shipment_item': null } }])
    expect(isEntityTypeProjected('sales:sales_shipment_item')).toBe(false)
  })

  it('replaces the previous override set rather than accumulating it', () => {
    applyQueryIndexOverrides([{ entities: { 'sales:sales_note': null } }])
    expect(isEntityTypeProjected('sales:sales_note')).toBe(false)

    applyQueryIndexOverrides([{ entities: { 'sales:sales_payment': null } }])
    expect(isEntityTypeProjected('sales:sales_note')).toBe(true)
    expect(isEntityTypeProjected('sales:sales_payment')).toBe(false)
  })

  it('re-resolves after a later module registration (HMR, worker bootstrap)', () => {
    applyQueryIndexOverrides([{ entities: { 'sales:sales_note': null } }])
    registerQueryIndexModuleConfigs([{ entities: [{ entityId: 'sales:sales_payment', project: false }] }])

    // The app override survives a module registration that lands after it.
    expect(isEntityTypeProjected('sales:sales_note')).toBe(false)
    expect(isEntityTypeProjected('sales:sales_payment')).toBe(false)
  })

  it('drops non-projected types from a candidate list', () => {
    applyQueryIndexOverrides([{ entities: { 'sales:sales_order_line': null } }])
    expect(filterProjectedEntityTypes(['sales:sales_order', 'sales:sales_order_line'])).toEqual([
      'sales:sales_order',
    ])
    expect(filterProjectedEntityTypes([])).toEqual([])
  })

  it('persists the policy on globalThis so a duplicated module instance reads the same answer', async () => {
    applyQueryIndexOverrides([{ entities: { 'sales:sales_order_line': null } }])

    // A standalone build can evaluate `@open-mercato/shared` through more than one
    // chunk. `jest.resetModules()` reproduces that: the re-imported copy has its own
    // module-local variables but shares `globalThis` with the copy that registered.
    jest.resetModules()
    const reimported = await import('../query-index')

    expect(reimported.isEntityTypeProjected('sales:sales_order_line')).toBe(false)
    expect(reimported.isEntityTypeProjected('sales:sales_order')).toBe(true)
  })

  describe('entity types search still indexes', () => {
    const searchConfigFor = (entityId: string, enabled?: boolean) =>
      [{ entities: [{ entityId, ...(enabled === undefined ? {} : { enabled }) }] }] as never

    it('refuses to stop one, and says so once', () => {
      registerSearchModuleConfigs(searchConfigFor('customers:customer'))
      applyQueryIndexOverrides([{ entities: { 'customers:customer': null } }])

      expect(isEntityTypeProjected('customers:customer')).toBe(true)
      expect(listNonProjectedEntityTypes()).toEqual([])
      expect(filterProjectedEntityTypes(['customers:customer'])).toEqual(['customers:customer'])

      isEntityTypeProjected('customers:customer')
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn.mock.calls[0][1]).toMatchObject({ entityType: 'customers:customer' })
    })

    it('honours the declaration once search is disabled for the entity', () => {
      registerSearchModuleConfigs(searchConfigFor('customers:customer', false))
      applyQueryIndexOverrides([{ entities: { 'customers:customer': null } }])

      expect(isEntityTypeProjected('customers:customer')).toBe(false)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('sees a search config registered after the projection declaration', () => {
      applyQueryIndexOverrides([{ entities: { 'customers:customer': null } }])
      expect(isEntityTypeProjected('customers:customer')).toBe(false)

      // Bootstrap registers search configs after the module registry, so the guard
      // must not be memoised alongside the declaration map.
      registerSearchModuleConfigs(searchConfigFor('customers:customer'))
      expect(isEntityTypeProjected('customers:customer')).toBe(true)
    })

    it('leaves a projected entity type alone', () => {
      registerSearchModuleConfigs(searchConfigFor('customers:customer'))
      expect(isEntityTypeProjected('customers:customer')).toBe(true)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  it('is reachable through the modules.ts override dispatcher', async () => {
    const { applyModuleOverridesFromEnabledModules } = await import('../overrides')
    applyModuleOverridesFromEnabledModules([
      { id: 'sales', overrides: { queryIndex: { entities: { 'sales:sales_payment_allocation': null } } } },
    ])
    expect(isEntityTypeProjected('sales:sales_payment_allocation')).toBe(false)
  })
})
