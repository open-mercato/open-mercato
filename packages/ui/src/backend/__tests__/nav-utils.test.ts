import {
  buildAdminNav,
  buildSettingsSections,
  computeSettingsPathPrefixes,
  convertToSectionNavGroups,
  type AdminNavItem,
} from '../utils/nav'

describe('settings navigation helpers', () => {
  it('includes only settings-context entries', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'System',
        groupId: 'settings.sections.system',
        groupKey: 'settings.sections.system',
        groupDefaultName: 'System',
        title: 'Audit Logs',
        defaultTitle: 'Audit Logs',
        href: '/backend/audit-logs',
        enabled: true,
        order: 10,
        pageContext: 'settings',
      },
      {
        group: 'Customers',
        groupId: 'customers.nav.group',
        groupDefaultName: 'Customers',
        title: 'People',
        defaultTitle: 'People',
        href: '/backend/customers/people',
        enabled: true,
        order: 1,
      },
    ]

    const sections = buildSettingsSections(entries, { system: 1 })

    expect(sections).toHaveLength(1)
    expect(sections[0].items.map((item) => item.href)).toEqual(['/backend/audit-logs'])
  })

  it('preserves nested children for settings section items', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Data Designer',
        groupId: 'settings.sections.dataDesigner',
        groupKey: 'settings.sections.dataDesigner',
        groupDefaultName: 'Data Designer',
        title: 'User Entities',
        defaultTitle: 'User Entities',
        titleKey: 'entities.nav.userEntities',
        href: '/backend/entities/user',
        enabled: true,
        order: 10,
        pageContext: 'settings',
        children: [
          {
            group: 'Data Designer',
            groupId: 'settings.sections.dataDesigner',
            groupKey: 'settings.sections.dataDesigner',
            groupDefaultName: 'Data Designer',
            title: 'Calendar Entity',
            defaultTitle: 'Calendar Entity',
            href: '/backend/entities/user/example%3Acalendar_entity/records',
            enabled: true,
            order: 1000,
          },
        ],
      },
    ]

    const sections = buildSettingsSections(entries, { 'data-designer': 3 })
    expect(sections).toHaveLength(1)
    expect(sections[0].items[0].children?.map((item) => item.href)).toEqual([
      '/backend/entities/user/example%3Acalendar_entity/records',
    ])

    const converted = convertToSectionNavGroups(sections)
    expect(converted[0].items[0].children?.map((item) => item.href)).toEqual([
      '/backend/entities/user/example%3Acalendar_entity/records',
    ])
  })

  it('does not treat parent routes as settings prefixes for leaf settings pages', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Module Configs',
        groupId: 'settings.sections.moduleConfigs',
        groupKey: 'settings.sections.moduleConfigs',
        groupDefaultName: 'Module Configs',
        title: 'Portal Settings',
        defaultTitle: 'Portal Settings',
        href: '/backend/customer_accounts/settings',
        enabled: true,
        order: 50,
        pageContext: 'settings',
      },
    ]

    const sections = buildSettingsSections(entries, { 'module-configs': 4 })
    const prefixes = computeSettingsPathPrefixes(sections)

    expect(prefixes).toContain('/backend/customer_accounts/settings')
    expect(prefixes).not.toContain('/backend/customer_accounts')
  })

  it('matches wildcard grants when building admin navigation', async () => {
    const entries = await buildAdminNav(
      [
        {
          id: 'customer_accounts',
          backendRoutes: [
            {
              pattern: '/backend/customer_accounts/users',
              title: 'Users',
              requireFeatures: ['customer_accounts.view'],
              pageContext: 'settings',
            },
          ],
        },
      ],
      { auth: { roles: [] } },
      undefined,
      undefined,
      {
        checkFeatures: async () => ['customer_accounts.*'],
      },
    )

    expect(entries.map((item) => item.href)).toContain('/backend/customer_accounts/users')
  })

  // Regression for GH #2070: an employee without any `configs.*` grant must not
  // see the system-status page in the sidebar (including settings sections),
  // even when modules with adjacent prefixes are granted.
  it('hides routes whose required features are not granted, including settings-context pages', async () => {
    const employeeGrants = [
      'sales.orders.view',
      'sales.quotes.view',
      'inbox_ops.proposals.view',
    ]
    const entries = await buildAdminNav(
      [
        {
          id: 'sales',
          backendRoutes: [
            {
              pattern: '/backend/sales/orders',
              title: 'Orders',
              requireFeatures: ['sales.orders.view'],
            },
            {
              pattern: '/backend/sales/quotes',
              title: 'Quotes',
              requireFeatures: ['sales.quotes.view'],
            },
          ],
        },
        {
          id: 'inbox_ops',
          backendRoutes: [
            {
              pattern: '/backend/inbox-ops',
              title: 'Proposals',
              requireFeatures: ['inbox_ops.proposals.view'],
            },
          ],
        },
        {
          id: 'configs',
          backendRoutes: [
            {
              pattern: '/backend/config/system-status',
              title: 'System status',
              requireFeatures: ['configs.system_status.view'],
              pageContext: 'settings',
              group: 'System',
              groupKey: 'settings.sections.system',
            },
          ],
        },
      ],
      { auth: { roles: [] } },
      undefined,
      undefined,
      {
        checkFeatures: async (features: string[]) =>
          features.filter((feature) => employeeGrants.includes(feature)),
      },
    )

    const hrefs = entries.map((item) => item.href)
    expect(hrefs).toContain('/backend/sales/orders')
    expect(hrefs).toContain('/backend/sales/quotes')
    expect(hrefs).toContain('/backend/inbox-ops')
    expect(hrefs).not.toContain('/backend/config/system-status')

    // The filtered settings entry must also be absent from any settings section.
    const settingsSections = buildSettingsSections(entries, { system: 1 })
    const allSettingsHrefs = settingsSections.flatMap((section) =>
      section.items.map((item) => item.href),
    )
    expect(allSettingsHrefs).not.toContain('/backend/config/system-status')
  })
})
