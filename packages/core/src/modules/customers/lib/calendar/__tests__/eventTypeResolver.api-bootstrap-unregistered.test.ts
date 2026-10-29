/**
 * Companion to `eventTypeResolver.api-bootstrap.test.ts`, in its own file on purpose: the widget
 * registry keeps module-local state that cannot be un-registered once any test has populated it,
 * so the never-registered state is only reachable in a module registry nothing else has touched.
 *
 * It pins the behavior the API partition used to produce: injection tables mount the calendar
 * spot while the widget-entry registry was never populated at all. Every other test in this
 * folder calls `registerCoreInjectionWidgets([])` in `beforeEach`, which leaves the registry
 * *registered but empty* — a state that resolves cleanly and therefore proves nothing here.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import {
  registerCoreInjectionTables,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

import { resolveScopedCalendarEventTypes } from '../eventTypeResolver'
import {
  resetCalendarEventTypeRegistryForTests,
  type CalendarEventTypeWidget,
} from '../../../calendar-event-types'

const GLOBAL_INJECTION_WIDGETS_KEY = '__openMercatoCoreInjectionWidgetEntries__'
const WIDGET_ID = 'example.injection.calendar-visit'

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

function clearRegistry() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_INJECTION_WIDGETS_KEY]
}

describe('calendar catalog when no partition registered widget entries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearRegistry()
    resetCalendarEventTypeRegistryForTests()
    findWithDecryptionMock.mockResolvedValue([])
    registerEnabledModuleIds(['customers', 'example'])
  })

  afterAll(() => {
    clearRegistry()
  })

  it('fails loudly rather than silently dropping the type when no partition registered entries', async () => {
    // The pre-fix API state: a table mounts the spot but the widget registry was never
    // populated. This must stay a loud bootstrap error the catalog surfaces as a retryable
    // failure — degrading it to "no contributions" would answer legitimate `visit` writes with
    // a wrong 400 instead.
    registerCoreInjectionTables([{ moduleId: 'example', table: injectionTable }], widgetEntries)

    await expect(resolveScopedCalendarEventTypes({
      em: {} as never,
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId],
    })).rejects.toThrow(/not registered/)
  })
})
