import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'record_locks.lock.acquired', label: 'Record Lock Acquired', entity: 'lock', category: 'crud' },
  { id: 'record_locks.participant.joined', label: 'Record Lock Participant Joined', entity: 'lock', category: 'lifecycle' },
  { id: 'record_locks.participant.left', label: 'Record Lock Participant Left', entity: 'lock', category: 'lifecycle' },
  { id: 'record_locks.lock.contended', label: 'Record Lock Contended', entity: 'lock', category: 'lifecycle' },
  { id: 'record_locks.lock.released', label: 'Record Lock Released', entity: 'lock', category: 'crud' },
  { id: 'record_locks.lock.force_released', label: 'Record Lock Force Released', entity: 'lock', category: 'crud' },
  { id: 'record_locks.record.deleted', label: 'Locked Record Deleted', entity: 'record', category: 'crud' },
  { id: 'record_locks.conflict.detected', label: 'Record Lock Conflict Detected', entity: 'conflict', category: 'crud' },
  { id: 'record_locks.conflict.resolved', label: 'Record Lock Conflict Resolved', entity: 'conflict', category: 'crud' },
  { id: 'record_locks.incoming_changes.available', label: 'Incoming Changes Available', entity: 'change', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'record_locks',
  events,
})

export const emitRecordLocksEvent = eventsConfig.emit

export type RecordLocksEventId = typeof events[number]['id']

export default eventsConfig
