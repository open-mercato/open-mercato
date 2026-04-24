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
  task: new Set([
    'title', 'date',
    'linkedEntities', 'description',
    'reminder', 'visibility',
  ]),
  email: new Set([
    'title', 'date', 'startTime',
    'linkedEntities', 'description',
    'visibility',
  ]),
}

type LabelOverride = { key: string; fallback: string }

export const FIELD_LABEL_OVERRIDES: Partial<
  Record<ActivityType, Partial<Record<ScheduleFieldId, LabelOverride>>>
> = {
  email: {
    title: { key: 'customers.schedule.subject', fallback: 'Subject' },
    description: { key: 'customers.schedule.body', fallback: 'Body' },
  },
  task: {
    date: { key: 'customers.schedule.dueDate', fallback: 'Due date' },
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
