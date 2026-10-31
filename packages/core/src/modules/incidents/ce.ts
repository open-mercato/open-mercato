import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '#generated/entities.ids.generated'

export const entities: CustomEntitySpec[] = [
  {
    id: E.incidents.incident,
    label: 'Incident',
    description: 'Operational incident',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'incidents:incident_trigger',
    label: 'Incident Trigger',
    description: 'Event-driven incident trigger',
    labelField: 'eventId',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
