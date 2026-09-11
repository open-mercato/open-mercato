import {
  buildAdminNav,
  buildProfileSections,
  buildSettingsSections,
  computeSettingsPathPrefixes,
  convertToSectionNavGroups,
  mergeSectionsWithDiscovered,
  type AdminNavItem,
  type SettingsSection,
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

  it('orders settings sections by the untranslated group id, not the rendered label', () => {
    const polishEntry = (
      group: string,
      groupKey: string,
      href: string,
    ): AdminNavItem => ({
      group,
      groupId: groupKey,
      groupKey,
      groupDefaultName: group,
      title: href,
      defaultTitle: href,
      href,
      enabled: true,
      order: 10,
      pageContext: 'settings',
    })

    const entries: AdminNavItem[] = [
      polishEntry('System', 'settings.sections.system', '/backend/config/system-status'),
      polishEntry('Konfiguracja modułów', 'settings.sections.moduleConfigs', '/backend/config/wms'),
      polishEntry('Autoryzacja', 'settings.sections.auth', '/backend/users'),
    ]

    const sections = buildSettingsSections(entries, {
      'settings.sections.system': 1,
      'settings.sections.auth': 2,
      'settings.sections.moduleConfigs': 5,
    })

    expect(sections.map((section) => section.id)).toEqual([
      'settings.sections.system',
      'settings.sections.auth',
      'settings.sections.moduleConfigs',
    ])
    expect(sections.map((section) => section.order)).toEqual([1, 2, 5])
  })

  it('keeps the section label and labelKey of the rendered group', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Konfiguracja modułów',
        groupId: 'settings.sections.moduleConfigs',
        groupKey: 'settings.sections.moduleConfigs',
        groupDefaultName: 'Konfiguracja modułów',
        title: 'WMS',
        defaultTitle: 'WMS',
        href: '/backend/config/wms',
        enabled: true,
        pageContext: 'settings',
      },
    ]

    const [section] = buildSettingsSections(entries, { 'settings.sections.moduleConfigs': 5 })

    expect(section.label).toBe('Konfiguracja modułów')
    expect(section.labelKey).toBe('settings.sections.moduleConfigs')
  })

  it('still honors legacy sectionOrder maps keyed by the English label slug', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Module Configs',
        groupId: 'settings.sections.moduleConfigs',
        groupKey: 'settings.sections.moduleConfigs',
        groupDefaultName: 'Module Configs',
        title: 'WMS',
        defaultTitle: 'WMS',
        href: '/backend/config/wms',
        enabled: true,
        pageContext: 'settings',
      },
    ]

    const [section] = buildSettingsSections(entries, { 'module-configs': 5 })

    expect(section.order).toBe(5)
  })

  it('falls back to the catch-all weight for groups the order map does not name', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Bezpieczeństwo',
        groupId: 'settings.sections.security',
        groupKey: 'settings.sections.security',
        groupDefaultName: 'Bezpieczeństwo',
        title: 'Audit Logs',
        defaultTitle: 'Audit Logs',
        href: '/backend/audit-logs',
        enabled: true,
        pageContext: 'settings',
      },
    ]

    const [section] = buildSettingsSections(entries, { 'settings.sections.system': 1 })

    expect(section.order).toBe(999)
  })

  // A partially translated locale renders `translate(groupKey, group)` as the localized label for
  // pages whose key is covered and as the raw English fallback for the rest, so one group can reach
  // buildSettingsSections under two different labels.
  it('groups entries that share a group id even when labels differ', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Konfiguracja modułów',
        groupId: 'settings.sections.moduleConfigs',
        groupKey: 'settings.sections.moduleConfigs',
        groupDefaultName: 'Konfiguracja modułów',
        title: 'WMS',
        defaultTitle: 'WMS',
        href: '/backend/config/wms',
        enabled: true,
        order: 20,
        pageContext: 'settings',
      },
      {
        group: 'Module Configs',
        groupId: 'settings.sections.moduleConfigs',
        groupKey: 'settings.sections.moduleConfigs',
        groupDefaultName: 'Module Configs',
        title: 'Sales',
        defaultTitle: 'Sales',
        href: '/backend/config/sales',
        enabled: true,
        order: 10,
        pageContext: 'settings',
      },
    ]

    const sections = buildSettingsSections(entries, { 'settings.sections.moduleConfigs': 5 })

    expect(sections).toHaveLength(1)
    expect(sections[0].items.map((item) => item.href)).toEqual([
      '/backend/config/sales',
      '/backend/config/wms',
    ])
  })
})

describe('profile navigation helpers', () => {
  const profileEntry = (overrides: Partial<AdminNavItem>): AdminNavItem => ({
    group: 'Account',
    groupId: 'profile.sections.account',
    groupKey: 'profile.sections.account',
    groupDefaultName: 'Account',
    title: 'Notification Preferences',
    defaultTitle: 'Notification Preferences',
    titleKey: 'notifications.preferences.pageTitle',
    href: '/backend/profile/notification-preferences',
    enabled: true,
    order: 30,
    pageContext: 'profile',
    ...overrides,
  })

  const accountBaseline = (): SettingsSection[] => [
    {
      id: 'profile.sections.account',
      label: 'Account',
      labelKey: 'profile.sections.account',
      order: 1,
      items: [
        {
          id: 'change-password',
          label: 'Change Password',
          labelKey: 'auth.changePassword.title',
          href: '/backend/profile/change-password',
          order: 1,
        },
      ],
    },
  ]

  it('includes only profile-context entries', () => {
    const entries: AdminNavItem[] = [
      profileEntry({}),
      profileEntry({
        group: 'System',
        groupId: 'settings.sections.system',
        groupKey: 'settings.sections.system',
        title: 'Audit Logs',
        defaultTitle: 'Audit Logs',
        href: '/backend/audit-logs',
        pageContext: 'settings',
      }),
      profileEntry({
        group: 'Customers',
        groupId: 'customers.nav.group',
        groupKey: undefined,
        title: 'People',
        defaultTitle: 'People',
        href: '/backend/customers/people',
        pageContext: undefined,
      }),
    ]

    const sections = buildProfileSections(entries, { 'profile.sections.account': 1 })

    expect(sections).toHaveLength(1)
    expect(sections[0].id).toBe('profile.sections.account')
    expect(sections[0].items.map((item) => item.href)).toEqual([
      '/backend/profile/notification-preferences',
    ])
  })

  it('folds discovered profile pages into the matching baseline section, ordered by weight', () => {
    const discovered = buildProfileSections(
      [
        profileEntry({}),
        profileEntry({
          title: 'My communication channels',
          defaultTitle: 'My communication channels',
          titleKey: 'communication_channels.profile.title',
          href: '/backend/profile/communication-channels',
          order: 20,
        }),
      ],
      { 'profile.sections.account': 1 },
    )

    const merged = mergeSectionsWithDiscovered(accountBaseline(), discovered)

    expect(merged).toHaveLength(1)
    expect(merged[0].items.map((item) => item.href)).toEqual([
      '/backend/profile/change-password',
      '/backend/profile/communication-channels',
      '/backend/profile/notification-preferences',
    ])
  })

  it('keeps the baseline entry when a discovered page repeats its href', () => {
    const discovered = buildProfileSections(
      [
        profileEntry({
          title: 'Password',
          defaultTitle: 'Password',
          titleKey: undefined,
          href: '/backend/profile/change-password',
          order: 99,
        }),
      ],
      { 'profile.sections.account': 1 },
    )

    const merged = mergeSectionsWithDiscovered(accountBaseline(), discovered)

    expect(merged[0].items).toHaveLength(1)
    expect(merged[0].items[0].labelKey).toBe('auth.changePassword.title')
  })

  it('appends a section a module declares under its own group id', () => {
    const discovered = buildProfileSections(
      [
        profileEntry({
          group: 'Security',
          groupId: 'security.profile.section',
          groupKey: 'security.profile.section',
          title: 'Security & MFA',
          defaultTitle: 'Security & MFA',
          titleKey: 'security.profile.pageTitle',
          href: '/backend/profile/security',
          order: 10,
        }),
      ],
      { 'profile.sections.account': 1 },
    )

    const merged = mergeSectionsWithDiscovered(accountBaseline(), discovered)

    expect(merged.map((section) => section.id)).toEqual([
      'profile.sections.account',
      'security.profile.section',
    ])
  })

  it('leaves the baseline untouched when nothing is discovered', () => {
    const baseline = accountBaseline()

    const merged = mergeSectionsWithDiscovered(baseline, [])

    expect(merged).toEqual(baseline)
    expect(merged[0]).not.toBe(baseline[0])
  })

  // The baseline is a module-level constant (`profileSections`) reused across every request, so
  // sorting a nested `children` array in place would permanently reorder shared state.
  it('sorts nested children into a copy rather than reordering the baseline array', () => {
    const children = [
      { id: 'mfa', label: 'MFA', href: '/backend/profile/security/mfa', order: 20 },
      { id: 'sessions', label: 'Sessions', href: '/backend/profile/security/sessions', order: 10 },
    ]
    const baseline: SettingsSection[] = [
      {
        id: 'profile.sections.account',
        label: 'Account',
        labelKey: 'profile.sections.account',
        order: 1,
        items: [
          {
            id: 'security',
            label: 'Security',
            href: '/backend/profile/security',
            order: 1,
            children,
          },
        ],
      },
    ]

    const merged = mergeSectionsWithDiscovered(baseline, [])

    expect(merged[0].items[0].children?.map((child) => child.id)).toEqual(['sessions', 'mfa'])
    expect(children.map((child) => child.id)).toEqual(['mfa', 'sessions'])
  })
})
