import type { InjectionCalendarEventTypeWidget } from '@open-mercato/shared/modules/widgets/injection'
import type { CalendarEventTypeDefinition } from '@open-mercato/core/modules/customers/calendar-event-types'

const visit: CalendarEventTypeDefinition = {
  key: 'visit',
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
}

const widget: InjectionCalendarEventTypeWidget = {
  metadata: { id: 'example.injection.calendar-visit', title: 'Visit calendar type' },
  eventTypes: [visit],
}

export default widget
