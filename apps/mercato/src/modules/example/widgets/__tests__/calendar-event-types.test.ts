import { calendarEventTypeDefinitionSchema } from '@open-mercato/core/modules/customers/calendar-event-types'
import calendarVisitWidget from '../injection/calendar-visit/widget'
import { injectionTable } from '../injection-table'

describe('example calendar event type contribution', () => {
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
    expect(calendarVisitWidget.eventTypeOverrides).toEqual({})
    expect(calendarVisitWidget.eventTypePatches).toEqual([])
  })

  it('hides Note and renames Meeting only when the demo is explicitly enabled', () => {
    const previous = process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES
    process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES = 'true'
    let demonstration: typeof calendarVisitWidget | undefined
    try {
      jest.isolateModules(() => { demonstration = require('../injection/calendar-visit/widget').default })
    } finally {
      if (previous === undefined) delete process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES
      else process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES = previous
    }
    expect(demonstration?.eventTypeOverrides).toEqual({ note: null })
    expect(demonstration?.eventTypePatches).toEqual([{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.calendar.customerMeeting' }],
    )
  })
})
