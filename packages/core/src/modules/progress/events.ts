import { createModuleEvents } from '@open-mercato/shared/modules/events'

export const events = [
  { id: 'progress.job.created', label: 'Job Created', entity: 'job', category: 'crud' },
  { id: 'progress.job.started', label: 'Job Started', entity: 'job', category: 'lifecycle' },
  { id: 'progress.job.updated', label: 'Job Updated', entity: 'job', category: 'lifecycle' },
  { id: 'progress.job.completed', label: 'Job Completed', entity: 'job', category: 'lifecycle' },
  { id: 'progress.job.failed', label: 'Job Failed', entity: 'job', category: 'lifecycle' },
  { id: 'progress.job.cancelled', label: 'Job Cancelled', entity: 'job', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'progress',
  events,
})

export const emitProgressEvent = eventsConfig.emit

export type ProgressEventId = typeof events[number]['id']

export default eventsConfig
