const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import {
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'

import {
  resolveCatalogEventType,
  resolveScopedCalendarEventTypes,
} from '../eventTypeResolver'
import {
  createCalendarEventTypeRegistry,
  calendarEventTypes,
  resetCalendarEventTypeRegistryForTests,
} from '../../../calendar-event-types'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const ancestorId = '33333333-3333-4333-8333-333333333333'

describe('scoped calendar event type resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetCalendarEventTypeRegistryForTests()
    registerCoreInjectionWidgets([])
    registerCoreInjectionTables([])
    registerEnabledModuleIds(['customers'])
  })

  test('layers inherited then local dictionary behavior without crossing scope', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        value: 'meeting',
        normalizedValue: 'meeting',
        label: 'Parent meeting',
        icon: 'parent',
        color: null,
        organizationId: ancestorId,
        activityTypeBehavior: null,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        value: 'meeting',
        normalizedValue: 'meeting',
        label: 'Local meeting',
        icon: 'local',
        color: '#112233',
        organizationId,
        activityTypeBehavior: {
          schemaVersion: 1,
          baseKind: 'meeting',
          selectable: true,
          order: 42,
          fields: {
            endTime: false,
            allDay: true,
            recurrence: false,
            location: 'location',
            people: 'attendees',
            priority: false,
            resources: false,
          },
          customFieldsetIds: ['visits'],
        },
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      },
    ])

    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId, ancestorId],
    })

    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        kind: 'activity_type',
        organizationId: { $in: [organizationId, ancestorId] },
      }),
      expect.any(Object),
      { tenantId, organizationId },
    )
    expect(catalog.items.find((item) => item.key === 'meeting')).toMatchObject({
      label: 'Local meeting',
      icon: 'local',
      isInherited: false,
      isLocalOverride: true,
      updatedAt: '2026-09-02T00:00:00.000Z',
      behavior: { order: 42, customFieldsetIds: ['visits'] },
    })
    expect(catalog.items.find((item) => item.key === 'meeting')?.labelKey).toBeUndefined()
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.items[0]?.behavior)).toBe(true)
  })

  test('keeps local precedence when the selected organization is repeated after ancestors', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { value: 'meeting', normalizedValue: 'meeting', label: 'Ancestor', organizationId: ancestorId, updatedAt: new Date() },
      { value: 'meeting', normalizedValue: 'meeting', label: 'Local', organizationId, updatedAt: new Date() },
    ])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [ancestorId, organizationId],
    })
    expect(catalog.items.find((item) => item.key === 'meeting')?.label).toBe('Local')
  })

  test('treats an unchanged shipped dictionary seed as a baseline value', async () => {
    createCalendarEventTypeRegistry().patch('example', { targetEventTypeKey: 'meeting', replaceLabel: 'Customer meeting' })
    findWithDecryptionMock.mockResolvedValue([{
      value: 'meeting',
      normalizedValue: 'meeting',
      label: 'Meeting',
      icon: 'lucide:users',
      color: '#f59e0b',
      activityTypeBehavior: null,
      organizationId,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [],
    })
    expect(catalog.items.find((item) => item.key === 'meeting')).toMatchObject({
      label: 'Customer meeting',
      isLocalOverride: false,
    })
  })

  test('keeps a nonconfigurable definition authoritative while reporting its stored overlay', async () => {
    createCalendarEventTypeRegistry().upsert('example', {
        ...calendarEventTypes[0]!,
        key: 'fixed-visit',
        label: 'Fixed visit',
        adminConfigurable: false,
    })
    findWithDecryptionMock.mockResolvedValue([{
      value: 'fixed-visit',
      normalizedValue: 'fixed-visit',
      label: 'Old override',
      organizationId,
      activityTypeBehavior: { ...calendarEventTypes[0]!.behavior, selectable: false },
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [],
    })
    expect(catalog.items.find((item) => item.key === 'fixed-visit')).toMatchObject({
      label: 'Fixed visit',
      selectable: true,
      adminConfigurable: false,
      inactiveDictionaryOverride: true,
    })
  })

  test('reports stale fieldsets when the entities boundary supplies the available set', async () => {
    findWithDecryptionMock.mockResolvedValue([{
      value: 'meeting',
      normalizedValue: 'meeting',
      label: 'Meeting',
      organizationId,
      updatedAt: new Date(),
      activityTypeBehavior: {
        schemaVersion: 1,
        baseKind: 'meeting',
        selectable: true,
        order: 1,
        fields: { endTime: true, allDay: true, recurrence: true, location: 'location', people: 'attendees', priority: false, resources: false },
        customFieldsetIds: ['available', 'removed'],
      },
    }])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [],
      availableCustomFieldsetIdsFromEntitiesBoundary: ['available'],
    })
    expect(catalog.items.find((item) => item.key === 'meeting')?.missingCustomFieldsetIds).toEqual(['removed'])
  })

  test('adds dictionary-only types and marks ancestor rows inherited', async () => {
    findWithDecryptionMock.mockResolvedValue([{
      value: 'site-visit',
      normalizedValue: 'site-visit',
      label: 'Site visit',
      icon: null,
      color: null,
      organizationId: ancestorId,
      activityTypeBehavior: null,
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    }])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [ancestorId],
    })
    expect(catalog.items.find((item) => item.key === 'site-visit')).toMatchObject({
      label: 'Site visit',
      selectable: true,
      source: 'dictionary',
      isInherited: true,
      isLocalOverride: false,
    })
  })

  test('returns an unavailable meeting-shaped historical fallback without rewriting the key', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [],
    })
    expect(resolveCatalogEventType(catalog, 'removed-type', { includeHistorical: true })).toMatchObject({
      key: 'removed-type',
      label: 'removed-type',
      selectable: false,
      historical: true,
      behavior: { baseKind: 'meeting', selectable: false },
    })
  })

  test('normalizes lookup without rewriting historical persisted keys', async () => {
    findWithDecryptionMock.mockResolvedValue([{ value: 'Site Visit', normalizedValue: 'site visit', label: 'Site Visit', organizationId, activityTypeBehavior: null, updatedAt: new Date() }])
    const catalog = await resolveScopedCalendarEventTypes({ em: {} as never, tenantId, organizationId, readableOrganizationIds: [] })
    expect(resolveCatalogEventType(catalog, ' Site Visit ')?.key).toBe('site visit')
    expect(resolveCatalogEventType(catalog, 'Removed Type', { includeHistorical: true })).toMatchObject({ key: 'Removed Type', historical: true })
  })

  test('preserves registry tombstone history and its last known behavior', async () => {
    createCalendarEventTypeRegistry().replace('example', 'task', null)
    findWithDecryptionMock.mockResolvedValue([{
      value: 'task',
      normalizedValue: 'task',
      label: 'Existing task dictionary row',
      organizationId,
      activityTypeBehavior: null,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }])
    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [],
    })
    expect(catalog.items.some((item) => item.key === 'task')).toBe(false)
    expect(resolveCatalogEventType(catalog, 'task', { includeHistorical: true })).toMatchObject({
      key: 'task',
      historical: true,
      fallbackReason: 'tombstoned',
      behavior: { baseKind: 'task', selectable: false },
    })
  })
})
