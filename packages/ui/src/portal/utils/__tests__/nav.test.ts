import type { FrontendRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { buildPortalNav, mergePortalSidebarGroupsWithInjected } from '../nav'

function makeRoute(partial: Partial<FrontendRouteManifestEntry>): FrontendRouteManifestEntry {
  return {
    moduleId: 'test',
    pattern: '/[orgSlug]/portal/test',
    load: async () => null as any,
    ...partial,
  } as FrontendRouteManifestEntry
}

describe('buildPortalNav', () => {
  it('auto-lists portal pages that declare nav metadata', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/dashboard',
        nav: { label: 'Dashboard', labelKey: 'portal.nav.dashboard', group: 'main', order: 10 },
      }),
      makeRoute({
        pattern: '/[orgSlug]/portal/profile',
        nav: { label: 'Profile', labelKey: 'portal.nav.profile', group: 'account', order: 10 },
      }),
    ]

    const groups = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })

    expect(groups).toEqual([
      {
        id: 'main',
        items: [
          expect.objectContaining({
            label: 'Dashboard',
            labelKey: 'portal.nav.dashboard',
            href: '/my-org/portal/dashboard',
            order: 10,
          }),
        ],
      },
      {
        id: 'account',
        items: [
          expect.objectContaining({
            label: 'Profile',
            labelKey: 'portal.nav.profile',
            href: '/my-org/portal/profile',
            order: 10,
          }),
        ],
      },
    ])
  })

  it('skips pages without nav metadata', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({ pattern: '/[orgSlug]/portal/login' }),
      makeRoute({
        pattern: '/[orgSlug]/portal/dashboard',
        nav: { label: 'Dashboard', group: 'main' },
      }),
    ]
    const groups = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('main')
    expect(groups[0].items.map((i) => i.label)).toEqual(['Dashboard'])
  })

  it('skips pages the user lacks required features for', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/orders',
        requireCustomerFeatures: ['portal.orders.view'],
        nav: { label: 'Orders', group: 'main' },
      }),
      makeRoute({
        pattern: '/[orgSlug]/portal/dashboard',
        nav: { label: 'Dashboard', group: 'main' },
      }),
    ]

    const groups = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })
    expect(groups).toEqual([
      { id: 'main', items: [expect.objectContaining({ label: 'Dashboard' })] },
    ])
  })

  it('matches wildcard grants like portal.*', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/orders',
        requireCustomerFeatures: ['portal.orders.view'],
        nav: { label: 'Orders', group: 'main' },
      }),
    ]

    const groups = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: ['portal.*'] })
    expect(groups).toEqual([{ id: 'main', items: [expect.objectContaining({ label: 'Orders' })] }])
  })

  it('bypasses feature checks when isPortalAdmin is true', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/orders',
        requireCustomerFeatures: ['portal.orders.view'],
        nav: { label: 'Orders', group: 'main' },
      }),
    ]

    const groups = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [], isPortalAdmin: true })
    expect(groups[0].items[0].label).toBe('Orders')
  })

  it('ignores navHidden pages even when nav is declared', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/secret',
        navHidden: true,
        nav: { label: 'Secret', group: 'main' },
      }),
    ]
    expect(buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })).toEqual([])
  })

  it('skips non-portal routes and dynamic patterns with unresolved params', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/orders/[id]',
        nav: { label: 'Order Detail', group: 'main' },
      }),
      makeRoute({
        pattern: '/[orgSlug]/checkout',
        nav: { label: 'Checkout', group: 'main' },
      }),
    ]
    expect(buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })).toEqual([])
  })

  it('dedupes manifest entries that share the same portal pattern', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        moduleId: 'core',
        pattern: '/[orgSlug]/portal/dashboard',
        nav: { label: 'Dashboard', group: 'main', order: 10 },
      }),
      makeRoute({
        moduleId: 'app',
        pattern: '/[orgSlug]/portal/dashboard',
        nav: { label: 'Dashboard', group: 'main', order: 10 },
      }),
    ]

    const groups = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })
    const main = groups.find((g) => g.id === 'main')!
    expect(main.items).toHaveLength(1)
    const ids = main.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prefers the override with non-empty requireCustomerFeatures over a broad fallback', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        moduleId: 'core',
        pattern: '/[orgSlug]/portal/dashboard',
        nav: { label: 'Dashboard', group: 'main' },
      }),
      makeRoute({
        moduleId: 'app',
        pattern: '/[orgSlug]/portal/dashboard',
        requireCustomerFeatures: ['portal.dashboard.view'],
        nav: { label: 'Dashboard', group: 'main' },
      }),
    ]

    const without = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })
    expect(without).toEqual([])

    const withGrant = buildPortalNav({
      routes,
      orgSlug: 'my-org',
      grantedFeatures: ['portal.dashboard.view'],
    })
    expect(withGrant).toEqual([
      { id: 'main', items: [expect.objectContaining({ label: 'Dashboard' })] },
    ])
  })

  it('prefers the override with the longer requireCustomerFeatures list', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        moduleId: 'core',
        pattern: '/[orgSlug]/portal/orders',
        requireCustomerFeatures: ['portal.orders.view'],
        nav: { label: 'Orders', group: 'main' },
      }),
      makeRoute({
        moduleId: 'app',
        pattern: '/[orgSlug]/portal/orders',
        requireCustomerFeatures: ['portal.orders.view', 'portal.orders.manage'],
        nav: { label: 'Orders', group: 'main' },
      }),
    ]

    const partial = buildPortalNav({
      routes,
      orgSlug: 'my-org',
      grantedFeatures: ['portal.orders.view'],
    })
    expect(partial).toEqual([])

    const full = buildPortalNav({
      routes,
      orgSlug: 'my-org',
      grantedFeatures: ['portal.orders.view', 'portal.orders.manage'],
    })
    expect(full[0].items[0].label).toBe('Orders')
  })

  it('sorts items by order then label', () => {
    const routes: FrontendRouteManifestEntry[] = [
      makeRoute({
        pattern: '/[orgSlug]/portal/b',
        nav: { label: 'B', group: 'main', order: 20 },
      }),
      makeRoute({
        pattern: '/[orgSlug]/portal/a',
        nav: { label: 'A', group: 'main', order: 10 },
      }),
      makeRoute({
        pattern: '/[orgSlug]/portal/aa',
        nav: { label: 'Aa', group: 'main', order: 10 },
      }),
    ]
    const main = buildPortalNav({ routes, orgSlug: 'my-org', grantedFeatures: [] })[0]
    expect(main.items.map((i) => i.label)).toEqual(['A', 'Aa', 'B'])
  })
})

describe('mergePortalSidebarGroupsWithInjected', () => {
  it('dedupes injected items by id', () => {
    const result = mergePortalSidebarGroupsWithInjected(
      [
        {
          id: 'main',
          items: [
            { id: 'portal-nav:/[orgSlug]/portal/dashboard', label: 'Dashboard', href: '/x/portal/dashboard', order: 10 },
          ],
        },
      ],
      {
        main: [
          { id: 'portal-nav:/[orgSlug]/portal/dashboard', label: 'Dashboard (injected)', href: '/x/portal/dashboard' } as any,
          { id: 'orders-external', label: 'External', href: 'https://external' } as any,
        ],
        account: [],
      },
    )
    expect(result.main).toHaveLength(2)
    expect(result.main[0]).toEqual(expect.objectContaining({ label: 'Dashboard' }))
    expect(result.main[1]).toEqual(expect.objectContaining({ id: 'orders-external' }))
  })

  it('dedupes injected items by href', () => {
    const result = mergePortalSidebarGroupsWithInjected(
      [
        {
          id: 'main',
          items: [
            { id: 'portal-nav:/[orgSlug]/portal/profile', label: 'Profile', href: '/x/portal/profile', order: 10 },
          ],
        },
      ],
      {
        main: [{ id: 'different-id', label: 'Profile', href: '/x/portal/profile' } as any],
        account: [],
      },
    )
    expect(result.main).toHaveLength(1)
  })
})
