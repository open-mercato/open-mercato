import { calendarEventTypes } from '../../../calendar-event-types'
import { clearInapplicableCoreFields, findInapplicableCoreFields, preserveHiddenCoreValuesOnSameTypeEdit } from '../interactionApplicability'

const meeting = calendarEventTypes.find((type) => type.key === 'meeting')!
const note = calendarEventTypes.find((type) => type.key === 'note')!
const noResourceNote = {
  ...note.behavior,
  fields: { ...note.behavior.fields, resources: false },
}

describe('calendar interaction field applicability', () => {
  it('rejects non-null core fields that a type cannot store', () => {
    expect(findInapplicableCoreFields(noResourceNote, {
      durationMinutes: 45,
      allDay: false,
      recurrenceRule: 'FREQ=DAILY',
      location: 'Office',
      participants: [{ name: 'A' }],
      priority: 10,
      linkedEntities: [{ type: 'resource', id: 'room' }],
    })).toEqual([
      'durationMinutes', 'allDay', 'recurrenceRule', 'priority',
      'location', 'participants', 'linkedEntities',
    ])
    expect(findInapplicableCoreFields(meeting.behavior, { location: 'Office' })).toEqual([])
  })

  it('clears only inapplicable values and preserves unrelated links', () => {
    expect(clearInapplicableCoreFields(noResourceNote, {
      location: 'Office',
      linkedEntities: [
        { type: 'resource', id: 'room' },
        { type: 'deal', id: 'deal' },
      ],
    })).toEqual({
      location: null,
      linkedEntities: [{ type: 'deal', id: 'deal' }],
    })
  })

  it('preserves hidden values when the same type is edited', () => {
    expect(preserveHiddenCoreValuesOnSameTypeEdit(noResourceNote, {
      location: 'Existing office',
      durationMinutes: 30,
      linkedEntities: [{ type: 'resource', id: 'room' }, { type: 'deal', id: 'old' }],
    }, {
      location: null,
      durationMinutes: null,
      linkedEntities: [{ type: 'deal', id: 'new' }],
    })).toEqual({
      linkedEntities: [{ type: 'deal', id: 'new' }, { type: 'resource', id: 'room' }],
    })
  })
})
