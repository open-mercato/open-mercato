/**
 * Characterization tests for `buildAdminNav`'s ordering contract.
 *
 * These lock in behavior that already existed — `buildAdminNav` is not modified by #4845. They
 * exist because the nav payload's serialization boundary (`auth/lib/backendChrome.tsx`) now mirrors
 * this precedence (`priority ?? order`, title tiebreak); if it changes here, the two sorts drift and
 * the payload's `order` field stops matching the sequence it ships items in.
 *
 * The regression coverage for #4845 itself lives in
 * `packages/shared/src/modules/__tests__/route-overrides.test.ts` (the override alias normalization)
 * and `packages/core/src/modules/auth/api/__tests__/admin-nav.test.ts` (the serialized field).
 */
import { buildAdminNav } from '../nav'

type NavModule = Parameters<typeof buildAdminNav>[0][number]

const passthroughTranslate = (_key: string | undefined, fallback: string) => fallback

function buildNav(modules: NavModule[]) {
  return buildAdminNav(modules, { auth: { roles: [] } }, [], passthroughTranslate, {
    checkFeatures: async (features) => features,
  })
}

describe('buildAdminNav item ordering', () => {
  it('sorts same-group items by declared order regardless of module registration order', async () => {
    const entries = await buildNav([
      {
        id: 'later_page',
        backendRoutes: [
          { pattern: '/backend/later/page-b', title: 'Beta page', group: 'Shared', groupKey: 'shared.nav.group', order: 71 },
        ],
      },
      {
        id: 'earlier_page',
        backendRoutes: [
          { pattern: '/backend/earlier/page-a', title: 'Alpha page', group: 'Shared', groupKey: 'shared.nav.group', order: 70 },
        ],
      },
    ] as NavModule[])

    expect(entries.map((entry) => entry.href)).toEqual([
      '/backend/earlier/page-a',
      '/backend/later/page-b',
    ])
    expect(entries.map((entry) => entry.order)).toEqual([70, 71])
  })

  it('sorts nested children by declared order and keeps the parent order intact', async () => {
    const entries = await buildNav([
      {
        id: 'wms',
        backendRoutes: [
          { pattern: '/backend/wms', title: 'Warehouse', group: 'WMS', groupKey: 'wms.nav.group', order: 95 },
          { pattern: '/backend/wms/zones', title: 'Zones', group: 'WMS', groupKey: 'wms.nav.group', order: 120 },
          { pattern: '/backend/wms/inventory', title: 'Inventory', group: 'WMS', groupKey: 'wms.nav.group', order: 100 },
        ],
      },
    ] as NavModule[])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.order).toBe(95)
    expect(entries[0]?.children?.map((child) => child.href)).toEqual([
      '/backend/wms/inventory',
      '/backend/wms/zones',
    ])
  })

  it('ranks an explicit priority ahead of the declared order', async () => {
    const entries = await buildNav([
      {
        id: 'reports',
        backendRoutes: [
          { pattern: '/backend/reports/monthly', title: 'Monthly', group: 'Reports', groupKey: 'reports.nav.group', order: 10 },
          { pattern: '/backend/reports/daily', title: 'Daily', group: 'Reports', groupKey: 'reports.nav.group', order: 20, priority: 1 },
        ],
      },
    ] as NavModule[])

    expect(entries.map((entry) => entry.href)).toEqual([
      '/backend/reports/daily',
      '/backend/reports/monthly',
    ])
  })
})
