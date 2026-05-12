import { FIELD_VISIBILITY, getFieldLabel, isVisible } from '../fieldConfig'

const passthroughT = (_key: string, fallback: string): string => fallback

describe('fieldConfig — per-type FIELD_VISIBILITY', () => {
  it('meeting surfaces the full visibility set including allDay/timezone/recurrence', () => {
    const meeting = FIELD_VISIBILITY.meeting
    expect(meeting.has('title')).toBe(true)
    expect(meeting.has('startTime')).toBe(true)
    expect(meeting.has('duration')).toBe(true)
    expect(meeting.has('allDay')).toBe(true)
    expect(meeting.has('timezone')).toBe(true)
    expect(meeting.has('recurrence')).toBe(true)
    expect(meeting.has('participants')).toBe(true)
  })

  it('task now exposes startTime + duration so DateTimeFields renders Due time + Estimate', () => {
    expect(isVisible('task', 'startTime')).toBe(true)
    expect(isVisible('task', 'duration')).toBe(true)
    expect(isVisible('task', 'allDay')).toBe(false)
  })

  it('email now exposes participants so the dialog can render the TO chip section', () => {
    expect(isVisible('email', 'participants')).toBe(true)
    expect(isVisible('email', 'duration')).toBe(false)
    expect(isVisible('email', 'recurrence')).toBe(false)
  })

  it('call retains the legacy visibility (no allDay/timezone)', () => {
    expect(isVisible('call', 'startTime')).toBe(true)
    expect(isVisible('call', 'duration')).toBe(true)
    expect(isVisible('call', 'participants')).toBe(true)
    expect(isVisible('call', 'allDay')).toBe(false)
    expect(isVisible('call', 'recurrence')).toBe(false)
  })
})

describe('fieldConfig — per-type FIELD_LABEL_OVERRIDES via getFieldLabel', () => {
  it('meeting renames participants to ATTENDEES and linkedEntities to CONNECTIONS', () => {
    expect(
      getFieldLabel('meeting', 'participants', passthroughT, 'customers.schedule.participants', 'Participants'),
    ).toBe('Attendees')
    expect(
      getFieldLabel('meeting', 'linkedEntities', passthroughT, 'customers.schedule.linkedEntities', 'Linked entities'),
    ).toBe('Connections')
  })

  it('call renames participants to CONTACT and description to CALL NOTES', () => {
    expect(
      getFieldLabel('call', 'participants', passthroughT, 'customers.schedule.participants', 'Participants'),
    ).toBe('Contact')
    expect(
      getFieldLabel('call', 'description', passthroughT, 'customers.schedule.description', 'Description'),
    ).toBe('Call notes')
    expect(
      getFieldLabel('call', 'linkedEntities', passthroughT, 'customers.schedule.linkedEntities', 'Linked entities'),
    ).toBe('Connections')
  })

  it('task renames date/startTime/duration/description for the Figma 790:280 layout', () => {
    expect(
      getFieldLabel('task', 'date', passthroughT, 'customers.schedule.date', 'Date'),
    ).toBe('Due date')
    expect(
      getFieldLabel('task', 'startTime', passthroughT, 'customers.schedule.start', 'Start'),
    ).toBe('Due time')
    expect(
      getFieldLabel('task', 'duration', passthroughT, 'customers.schedule.duration', 'Duration'),
    ).toBe('Estimate')
    expect(
      getFieldLabel('task', 'description', passthroughT, 'customers.schedule.description', 'Description'),
    ).toBe('Details')
  })

  it('email renames title to SUBJECT and participants to TO and description to MESSAGE', () => {
    expect(
      getFieldLabel('email', 'title', passthroughT, 'customers.schedule.titleLabel', 'Title'),
    ).toBe('Subject')
    expect(
      getFieldLabel('email', 'participants', passthroughT, 'customers.schedule.participants', 'Participants'),
    ).toBe('To')
    expect(
      getFieldLabel('email', 'description', passthroughT, 'customers.schedule.description', 'Description'),
    ).toBe('Message')
  })

  it('falls back to the default label when no override is registered', () => {
    expect(
      getFieldLabel('meeting', 'date', passthroughT, 'customers.schedule.date', 'Date'),
    ).toBe('Date')
    expect(
      getFieldLabel('meeting', 'description', passthroughT, 'customers.schedule.description', 'Description'),
    ).toBe('Description')
  })
})
