import { buildSettingsSections, convertToSectionNavGroups, type AdminNavItem } from '../utils/nav'

describe('settings navigation helpers', () => {
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
})
