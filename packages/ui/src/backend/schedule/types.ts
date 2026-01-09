export type ScheduleViewMode = 'day' | 'week' | 'month' | 'agenda'

export type ScheduleRange = {
  start: Date
  end: Date
}

export type ScheduleSlot = {
  start: Date
  end: Date
}

export type ScheduleItem = {
  id: string
  kind: 'availability' | 'event' | 'exception'
  title: string
  startsAt: Date
  endsAt: Date
  status?: 'draft' | 'negotiation' | 'confirmed' | 'cancelled'
  subjectType?: 'member' | 'resource'
  subjectId?: string
  color?: string
  linkLabel?: string
  linkHref?: string
  metadata?: Record<string, unknown>
}
