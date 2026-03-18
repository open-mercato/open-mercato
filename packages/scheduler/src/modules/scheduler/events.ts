import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // Job lifecycle
  { id: 'scheduler.job.started', label: 'Scheduled Job Started', entity: 'scheduled_job', category: 'lifecycle' },
  { id: 'scheduler.job.completed', label: 'Scheduled Job Completed', entity: 'scheduled_job', category: 'lifecycle' },
  { id: 'scheduler.job.failed', label: 'Scheduled Job Failed', entity: 'scheduled_job', category: 'lifecycle' },
  { id: 'scheduler.job.skipped', label: 'Scheduled Job Skipped', entity: 'scheduled_job', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'scheduler',
  events,
})

/** Type-safe event emitter for scheduler module */
export const emitSchedulerEvent = eventsConfig.emit

/** Event IDs that can be emitted by the scheduler module */
export type SchedulerEventId = typeof events[number]['id']

export default eventsConfig
