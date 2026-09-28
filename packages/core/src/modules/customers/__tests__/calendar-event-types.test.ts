import {
  calendarEventTypeBehaviorSchema,
  calendarEventTypeDefinitionSchema,
  calendarEventTypes,
  getCalendarEventTypeDiagnostics,
  getCalendarEventTypes,
  getCalendarEventTypeTombstones,
  registerCalendarEventTypeEntries,
  registerProgrammaticCalendarEventTypeEntries,
  resetCalendarEventTypeRegistryForTests,
  resolveCalendarEventType,
  type CalendarEventTypeDefinition,
  type NormalizedCalendarEventTypeEntry,
} from '../calendar-event-types'
import { editorKindOfInteractionType } from '../lib/calendar/editorPayload'

const meeting = calendarEventTypes[0] as CalendarEventTypeDefinition

function entry(
  moduleId: string,
  moduleOrder: number,
  definitions: CalendarEventTypeDefinition[] = [],
  overrides: NormalizedCalendarEventTypeEntry['overrides'] = {},
): NormalizedCalendarEventTypeEntry {
  return { moduleId, sourcePath: `${moduleId}/calendar-event-types.ts`, moduleOrder, definitions, overrides }
}

beforeEach(resetCalendarEventTypeRegistryForTests)

describe('calendar event type contracts', () => {
  it('keeps the six shipped behaviors immutable and rejects unknown properties', () => {
    expect(calendarEventTypes.map((definition) => definition.key)).toEqual(['meeting', 'call', 'email', 'note', 'event', 'task'])
    expect(Object.isFrozen(calendarEventTypes)).toBe(true)
    expect(Object.isFrozen(calendarEventTypes[0]?.behavior.fields)).toBe(true)
    expect(() => calendarEventTypeBehaviorSchema.parse({ ...meeting.behavior, unexpected: true })).toThrow()
    expect(() => calendarEventTypeDefinitionSchema.parse({ ...meeting, unexpected: true })).toThrow()
  })

  it('composes additions, property patches, replacement arrays, and programmatic overrides deterministically', () => {
    registerCalendarEventTypeEntries([
      entry('later', 20, [], { meeting: { color: 'later', behavior: { fields: { allDay: false }, customFieldsetIds: ['later'] } } }),
      entry('earlier', 10, [{ ...meeting, key: 'site-visit', label: 'Site visit', behavior: { ...meeting.behavior, baseKind: 'event', order: 50 } }], {
        meeting: { label: 'Patched meeting', behavior: { fields: { recurrence: false }, customFieldsetIds: ['earlier', 'shared'] } },
      }),
    ])
    registerProgrammaticCalendarEventTypeEntries([
      entry('app', 0, [], { meeting: { icon: 'app-icon' } }),
    ])

    expect(getCalendarEventTypes().map((definition) => definition.key).slice(0, 3)).toEqual(['meeting', 'site-visit', 'call'])
    const resolved = resolveCalendarEventType('meeting')
    expect(resolved).toMatchObject({
      label: 'Patched meeting',
      color: 'later',
      icon: 'app-icon',
      behavior: { fields: { allDay: false, recurrence: false }, customFieldsetIds: ['later'] },
    })
    expect(resolved?.provenance.label.moduleId).toBe('earlier')
    expect(resolved?.provenance.color.moduleId).toBe('later')
    expect(resolved?.provenance.icon.phase).toBe('programmatic')
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved?.behavior.fields)).toBe(true)
    expect(editorKindOfInteractionType('site-visit')).toBe('event')
  })

  it('rejects duplicate definitions and reports unknown patches', () => {
    expect(() => registerCalendarEventTypeEntries([
      entry('first', 0, [{ ...meeting, key: 'duplicate', label: 'First' }]),
      entry('second', 1, [{ ...meeting, key: 'duplicate', label: 'Second' }]),
    ])).toThrow('modules "first" and "second"')

    resetCalendarEventTypeRegistryForTests()
    registerCalendarEventTypeEntries([entry('unknown-patcher', 0, [], { missing: { label: 'Missing' } })])
    expect(getCalendarEventTypeDiagnostics()).toEqual([
      { code: 'unknown-override', key: 'missing', moduleId: 'unknown-patcher' },
    ])
  })

  it('uses tombstones only for selection and preserves historical semantics', () => {
    registerCalendarEventTypeEntries([entry('hide', 0, [], { task: null })])
    expect(resolveCalendarEventType('task')).toBeUndefined()
    expect(getCalendarEventTypeTombstones()).toMatchObject([{ key: 'task' }])
    expect(resolveCalendarEventType('task', { includeHistorical: true })).toMatchObject({
      key: 'task',
      historical: true,
      fallbackReason: 'tombstoned',
      behavior: { baseKind: 'task', selectable: false },
    })
  })

  it('retains a disappeared module definition and falls back safely for an unknown historical key', () => {
    registerCalendarEventTypeEntries([
      entry('visits', 0, [{ ...meeting, key: 'site-visit', label: 'Site visit', behavior: { ...meeting.behavior, baseKind: 'event' } }]),
    ])
    registerCalendarEventTypeEntries([])
    expect(resolveCalendarEventType('site-visit')).toBeUndefined()
    expect(resolveCalendarEventType('site-visit', { includeHistorical: true })).toMatchObject({
      key: 'site-visit',
      label: 'Site visit',
      fallbackReason: 'module-unavailable',
      behavior: { baseKind: 'event', selectable: false },
    })
    expect(resolveCalendarEventType('legacy-type', { includeHistorical: true })).toMatchObject({
      key: 'legacy-type',
      label: 'legacy-type',
      fallbackReason: 'unknown',
      behavior: { baseKind: 'meeting', selectable: false },
    })
  })

  it('replaces the same generated module entry idempotently', () => {
    registerCalendarEventTypeEntries([entry('patcher', 0, [], { meeting: { label: 'First' } })])
    registerCalendarEventTypeEntries([entry('patcher', 0, [], { meeting: { label: 'Second' } })])
    expect(resolveCalendarEventType('meeting')?.label).toBe('Second')
  })
})
