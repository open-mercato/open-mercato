import { calendarEventTypeDefinitionSchema } from '@open-mercato/core/modules/customers/calendar-event-types'
import { exampleCalendarOverrides } from '../../../../modules'
import calendarVisitWidget from '../injection/calendar-visit/widget'
import { injectionTable } from '../injection-table'

describe('example calendar event type contribution', () => {
  it('adds Visit through the generic widget spot with bounded behavior', () => {
    expect(injectionTable['calendar:customers.event-types']).toBe('example.injection.calendar-visit')
    expect(calendarVisitWidget.metadata.id).toBe('example.injection.calendar-visit')
    const visit = calendarEventTypeDefinitionSchema.parse(calendarVisitWidget.eventTypes[0])
    expect(visit).toMatchObject({
      key: 'visit',
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

  it('hides Note and renames Meeting through module configuration', () => {
    expect(exampleCalendarOverrides).toEqual({
      eventTypes: { note: null },
      patches: [{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.calendar.customerMeeting' }],
    })
  })
})
