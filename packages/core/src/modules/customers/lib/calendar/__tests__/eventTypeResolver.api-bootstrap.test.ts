/**
 * The calendar catalog is resolved on the API request path (`POST/PUT /api/customers/interactions`
 * and `GET /api/customers/activity-types`), and those routes run under the API-only bootstrap
 * partition — not the full page bootstrap.
 *
 * Every other test in this folder calls `registerCoreInjectionWidgets([])` in `beforeEach`, which
 * leaves the registry *registered but empty*. That is not the state the API partition produces, so
 * it cannot see whether a contributing module's type actually reaches an API-only process. These
 * tests reproduce the partition itself: injection tables populated from the generated registry and
 * widget entries merged in exactly as `bootstrap-api.ts` supplies them.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import {
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

import { resolveScopedCalendarEventTypes } from '../eventTypeResolver'
import {
  getCalendarEventTypeDiagnostics,
  resetCalendarEventTypeRegistryForTests,
  type CalendarEventTypeWidget,
} from '../../../calendar-event-types'

const GLOBAL_INJECTION_WIDGETS_KEY = '__openMercatoCoreInjectionWidgetEntries__'
const WIDGET_ID = 'example.injection.calendar-visit'
const MALFORMED_WIDGET_ID = 'example.injection.malformed-calendar-type'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const visitWidget: CalendarEventTypeWidget = {
  metadata: { id: WIDGET_ID, title: 'Visit calendar type', requiredModules: ['customers'] },
  Widget: () => null,
  eventTypes: [{
    key: 'visit',
    adminConfigurable: false,
    label: 'Visit',
    labelKey: 'example.calendar.visit',
    icon: 'lucide:map-pin',
    panelKey: 'example.visit',
    behavior: {
      schemaVersion: 1,
      baseKind: 'event',
      selectable: true,
      order: 450,
      fields: {
        endTime: true,
        allDay: false,
        recurrence: false,
        location: 'location',
        people: 'recipients',
        priority: false,
        resources: true,
      },
      customFieldsetIds: [],
    },
  }],
}

const injectionTable: ModuleInjectionTable = { 'calendar:customers.event-types': WIDGET_ID }
const widgetEntries: ModuleInjectionWidgetEntry[] = [{
  moduleId: 'example',
  key: 'example:calendar-visit:widget',
  source: 'app',
  widgetId: WIDGET_ID,
  loader: async () => visitWidget,
}]

const malformedWidgetEntries: ModuleInjectionWidgetEntry[] = [{
  moduleId: 'example',
  key: 'example:malformed-calendar-type:widget',
  source: 'app',
  widgetId: MALFORMED_WIDGET_ID,
  loader: async () => ({
    metadata: { id: MALFORMED_WIDGET_ID, title: 'Malformed calendar type', requiredModules: ['customers'] },
    Widget: () => null,
  }),
}]

function clearRegistry() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_INJECTION_WIDGETS_KEY]
}

describe('calendar catalog under the API-only bootstrap partition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    clearRegistry()
    resetCalendarEventTypeRegistryForTests()
    findWithDecryptionMock.mockResolvedValue([])
    registerEnabledModuleIds(['customers', 'example'])
  })

  afterAll(() => {
    clearRegistry()
  })

  it('resolves a contributing module type when only the API partition has registered', async () => {
    // Exactly what `bootstrap-api.ts` does: tables always, entries merged so the partition can
    // never shrink a registry the full page bootstrap may have published in the same process.
    registerCoreInjectionTables([{ moduleId: 'example', table: injectionTable }], widgetEntries)
    registerCoreInjectionWidgets(widgetEntries, { mode: 'merge' })

    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId],
    })

    expect(catalog.items.map((item) => item.key)).toContain('visit')
  })

  it('skips a widget without an eventTypes payload and records an invalid-source diagnostic', async () => {
    registerCoreInjectionTables([{
      moduleId: 'example',
      table: { 'calendar:customers.event-types': MALFORMED_WIDGET_ID },
    }], malformedWidgetEntries)
    registerCoreInjectionWidgets(malformedWidgetEntries, { mode: 'merge' })

    const catalog = await resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId],
    })

    expect(catalog.items.map((item) => item.key)).toContain('meeting')
    expect(getCalendarEventTypeDiagnostics()).toContainEqual({
      code: 'invalid-source',
      moduleId: 'example',
      widgetId: MALFORMED_WIDGET_ID,
    })
  })
})
