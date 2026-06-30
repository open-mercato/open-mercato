import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'data_quality.check.created', label: 'Data Quality Check Created', entity: 'check', category: 'crud' },
  { id: 'data_quality.check.updated', label: 'Data Quality Check Updated', entity: 'check', category: 'crud' },
  { id: 'data_quality.check.deleted', label: 'Data Quality Check Deleted', entity: 'check', category: 'crud' },
  { id: 'data_quality.suite.created', label: 'Data Quality Suite Created', entity: 'suite', category: 'crud' },
  { id: 'data_quality.suite.updated', label: 'Data Quality Suite Updated', entity: 'suite', category: 'crud' },
  { id: 'data_quality.suite.deleted', label: 'Data Quality Suite Deleted', entity: 'suite', category: 'crud' },
  {
    id: 'data_quality.scan.started',
    label: 'Data Quality Scan Started',
    entity: 'scan',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'data_quality.scan.completed',
    label: 'Data Quality Scan Completed',
    entity: 'scan',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'data_quality.scan.failed',
    label: 'Data Quality Scan Failed',
    entity: 'scan',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'data_quality.scan.cancelled',
    label: 'Data Quality Scan Cancelled',
    entity: 'scan',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  { id: 'data_quality.finding.opened', label: 'Data Quality Finding Opened', entity: 'finding', category: 'lifecycle' },
  {
    id: 'data_quality.finding.resolved',
    label: 'Data Quality Finding Resolved',
    entity: 'finding',
    category: 'lifecycle',
  },
  { id: 'data_quality.finding.ignored', label: 'Data Quality Finding Ignored', entity: 'finding', category: 'lifecycle' },
  { id: 'data_quality.finding.reopened', label: 'Data Quality Finding Reopened', entity: 'finding', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'data_quality',
  events,
})

export const emitDataQualityEvent = eventsConfig.emit

export type DataQualityEventId = (typeof events)[number]['id']

export default eventsConfig
