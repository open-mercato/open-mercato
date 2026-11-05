import { CATEGORY_BY_TYPE, categoryOf, countByCategory } from '../categories'
import { makeCalendarItem } from './fixtures'

describe('CATEGORY_BY_TYPE', () => {
  it('maps meeting-like types to meeting', () => {
    expect(CATEGORY_BY_TYPE.meeting).toBe('meeting')
    expect(CATEGORY_BY_TYPE.call).toBe('meeting')
    expect(CATEGORY_BY_TYPE['video-call']).toBe('meeting')
  })

  it('maps event-like types to event', () => {
    expect(CATEGORY_BY_TYPE.event).toBe('event')
    expect(CATEGORY_BY_TYPE.webinar).toBe('event')
  })

  it('maps task-like types to task', () => {
    expect(CATEGORY_BY_TYPE.task).toBe('task')
    expect(CATEGORY_BY_TYPE.todo).toBe('task')
    expect(CATEGORY_BY_TYPE.deadline).toBe('task')
  })
})

describe('categoryOf', () => {
  it('resolves mapped types', () => {
    expect(categoryOf('call')).toBe('meeting')
    expect(categoryOf('webinar')).toBe('event')
    expect(categoryOf('deadline')).toBe('task')
  })

  it('falls back to other for unmapped tenant types', () => {
    expect(categoryOf('email')).toBe('other')
    expect(categoryOf('note')).toBe('other')
    expect(categoryOf('custom-onboarding')).toBe('other')
    expect(categoryOf('')).toBe('other')
  })
})

describe('countByCategory', () => {
  it('counts meetings and events while all covers every item', () => {
    const start = new Date(2026, 5, 11, 10, 0, 0)
    const end = new Date(2026, 5, 11, 11, 0, 0)
    const items = [
      makeCalendarItem({ id: 'meeting-1', start, end, category: 'meeting' }),
      makeCalendarItem({ id: 'meeting-2', start, end, category: 'meeting' }),
      makeCalendarItem({ id: 'event-1', start, end, category: 'event' }),
      makeCalendarItem({ id: 'task-1', start, end, category: 'task' }),
      makeCalendarItem({ id: 'other-1', start, end, category: 'other' }),
    ]
    expect(countByCategory(items)).toEqual({ all: 5, meetings: 2, events: 1 })
  })

  it('returns zero counts for an empty window', () => {
    expect(countByCategory([])).toEqual({ all: 0, meetings: 0, events: 0 })
  })
})
