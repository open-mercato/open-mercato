export type ActivityType = 'meeting' | 'call' | 'task' | 'email'

export type ScheduleFieldId =
  | 'title'
  | 'date'
  | 'startTime'
  | 'duration'
  | 'allDay'
  | 'timezone'
  | 'recurrence'
  | 'participants'
  | 'guestPermissions'
  | 'location'
  | 'linkedEntities'
  | 'description'
  | 'reminder'
  | 'visibility'

export const FIELD_VISIBILITY: Record<ActivityType, Set<ScheduleFieldId>> = {
  meeting: new Set([
    'title', 'date', 'startTime', 'duration', 'allDay', 'timezone', 'recurrence',
    'participants', 'guestPermissions', 'location', 'linkedEntities', 'description',
    'reminder', 'visibility',
  ]),
  call: new Set([
    'title', 'date', 'startTime', 'duration',
    'participants', 'linkedEntities', 'description',
    'reminder', 'visibility',
  ]),
  // Task: now also surfaces Due time (startTime) + Estimate (duration) per Figma 790:280.
  task: new Set([
    'title', 'date', 'startTime', 'duration',
    'linkedEntities', 'description',
    'reminder', 'visibility',
  ]),
  // Email: surface participants as TO recipients per Figma 790:510.
  email: new Set([
    'title', 'date', 'startTime',
    'participants', 'linkedEntities', 'description',
    'reminder', 'visibility',
  ]),
}

type LabelOverride = { key: string; fallback: string }

// Per-type section labels (Figma 784:1255 / 829:50 / 790:280 / 790:510).
// `participants` / `linkedEntities` / `description` resolve via these overrides
// when present; otherwise the field components fall back to their generic key.
export const FIELD_LABEL_OVERRIDES: Partial<
  Record<ActivityType, Partial<Record<ScheduleFieldId, LabelOverride>>>
> = {
  meeting: {
    participants: { key: 'customers.schedule.attendees', fallback: 'Attendees' },
    linkedEntities: { key: 'customers.schedule.connections', fallback: 'Connections' },
  },
  call: {
    participants: { key: 'customers.schedule.contact', fallback: 'Contact' },
    linkedEntities: { key: 'customers.schedule.connections', fallback: 'Connections' },
    description: { key: 'customers.schedule.callNotes', fallback: 'Call notes' },
  },
  task: {
    date: { key: 'customers.schedule.dueDate', fallback: 'Due date' },
    startTime: { key: 'customers.schedule.dueTime', fallback: 'Due time' },
    duration: { key: 'customers.schedule.estimate', fallback: 'Estimate' },
    linkedEntities: { key: 'customers.schedule.connections', fallback: 'Connections' },
    description: { key: 'customers.schedule.details', fallback: 'Details' },
  },
  email: {
    title: { key: 'customers.schedule.subject', fallback: 'Subject' },
    participants: { key: 'customers.schedule.to', fallback: 'To' },
    linkedEntities: { key: 'customers.schedule.connections', fallback: 'Connections' },
    description: { key: 'customers.schedule.message', fallback: 'Message' },
  },
}

export function isVisible(type: ActivityType, fieldId: ScheduleFieldId): boolean {
  return FIELD_VISIBILITY[type].has(fieldId)
}

export function getFieldLabel(
  type: ActivityType,
  fieldId: ScheduleFieldId,
  t: (key: string, fallback: string) => string,
  defaultKey: string,
  defaultFallback: string,
): string {
  const override = FIELD_LABEL_OVERRIDES[type]?.[fieldId]
  if (override) return t(override.key, override.fallback)
  return t(defaultKey, defaultFallback)
}
