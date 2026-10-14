import {
  calendarEventTypeDefinitionSchema,
  createCalendarEventTypeRegistry,
  getCalendarEventTypes,
  getCalendarEventTypeTombstones,
  registerWidgetCalendarEventTypeContributions,
  resetCalendarEventTypeRegistryForTests,
} from '@open-mercato/core/modules/customers/calendar-event-types'
import calendarVisitWidget from '../injection/calendar-visit/widget'
import { injectionTable } from '../injection-table'

describe('example calendar event type contribution', () => {
  beforeEach(resetCalendarEventTypeRegistryForTests)
  afterEach(resetCalendarEventTypeRegistryForTests)
  it('adds Visit through the generic widget spot with bounded behavior', () => {
    expect(injectionTable['calendar:customers.event-types']).toBe('example.injection.calendar-visit')
    expect(calendarVisitWidget.metadata.id).toBe('example.injection.calendar-visit')
    const visit = calendarEventTypeDefinitionSchema.parse(calendarVisitWidget.eventTypes[0])
    expect(visit).toMatchObject({
      key: 'visit',
      adminConfigurable: false,
      labelKey: 'example.calendar.visit',
      panelKey: 'example.visit',
      behavior: {
        baseKind: 'event',
        fields: {
          endTime: true,
          allDay: false,
          recurrence: false,
          people: 'recipients',
          resources: true,
        },
      },
    })
  })

  it('keeps the default application types unchanged', () => {
    expect(calendarVisitWidget.eventTypeOverrides).toBeUndefined()
    expect(calendarVisitWidget.eventTypePatches).toEqual([])
  })

  it.each([false, true])('preserves every built-in type with demo overrides enabled=%s', (enabled) => {
    const previous = process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES
    process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES = String(enabled)
    let demonstration = calendarVisitWidget
    try {
      jest.isolateModules(() => { demonstration = require('../injection/calendar-visit/widget').default })
    } finally {
      if (previous === undefined) delete process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES
      else process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES = previous
    }
    expect(demonstration.eventTypeOverrides).toBeUndefined()
    expect(demonstration.eventTypePatches).toEqual(enabled
      ? [{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.calendar.customerMeeting' }] : [])
    registerWidgetCalendarEventTypeContributions([{
      moduleId: 'example', widgetId: demonstration.metadata.id,
      definitions: demonstration.eventTypes, patches: demonstration.eventTypePatches,
    }])
    const registry = createCalendarEventTypeRegistry()
    for (const definition of demonstration.eventTypes) registry.upsert('example', definition)
    for (const patch of demonstration.eventTypePatches ?? []) registry.patch('example', patch)
    const types = getCalendarEventTypes()
    expect(types.map((definition) => definition.key).sort()).toEqual(['call', 'email', 'event', 'meeting', 'note', 'task', 'visit'])
    expect(types.every((definition) => definition.behavior.selectable)).toBe(true)
    expect(types.find((definition) => definition.key === 'meeting')?.labelKey).toBe(enabled
      ? 'example.calendar.customerMeeting' : 'customers.calendar.editor.types.meeting')
    expect(getCalendarEventTypeTombstones()).toEqual([])
  })
})
