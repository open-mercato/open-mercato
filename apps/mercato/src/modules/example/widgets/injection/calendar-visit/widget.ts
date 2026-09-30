import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { CalendarEventTypeDefinition, CalendarEventTypeWidget } from '@open-mercato/core/modules/customers/calendar-event-types'

const visit: CalendarEventTypeDefinition = {
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
}

const widget: CalendarEventTypeWidget = {
  metadata: { id: 'example.injection.calendar-visit', title: 'Visit calendar type', requiredModules: ['customers'] },
  Widget: () => null,
  eventTypes: [visit],
  eventTypeOverrides: parseBooleanWithDefault(process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES, false) ? { note: null } : {},
  eventTypePatches: parseBooleanWithDefault(process.env.OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES, false)
    ? [{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.calendar.customerMeeting' }] : [],
}

export default widget
