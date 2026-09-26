/** @jest-environment node */

// Every Open Mercato app projects every entity type a write path names into
// `entity_indexes`, and until now nothing let an app say "not this one". These
// tests pin the resolution order of the switch that does: module declarations
// first, app `modules.ts` overrides on top, everything else projected.

jest.mock('../../lib/logger', () => ({
  createLogger: () => {
    const child = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    return { child: () => child, ...child }
  },
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

beforeEach(() => {
  resetQueryIndexProjectionPolicyForTests()
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

  it('is reachable through the modules.ts override dispatcher', async () => {
    const { applyModuleOverridesFromEnabledModules } = await import('../overrides')
    applyModuleOverridesFromEnabledModules([
      { id: 'sales', overrides: { queryIndex: { entities: { 'sales:sales_payment_allocation': null } } } },
    ])
    expect(isEntityTypeProjected('sales:sales_payment_allocation')).toBe(false)
  })
})
