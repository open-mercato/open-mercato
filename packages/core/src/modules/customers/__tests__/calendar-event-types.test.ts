import {
  calendarEventTypeBehaviorSchema,
  calendarEventTypeDefinitionSchema,
  calendarEventTypePatchSchema,
  calendarEventTypes,
  createCalendarEventTypeRegistry,
  getCalendarEventTypeDiagnostics,
  getCalendarEventTypeRegistryVersion,
  getCalendarEventTypes,
  registerCalendarModuleOverrides,
  registerWidgetCalendarEventTypeContributions,
  resetCalendarEventTypeRegistryForTests,
  resolveCalendarEventType,
  type CalendarEventTypeDefinition,
} from '../calendar-event-types'
import { editorKindOfInteractionType } from '../lib/calendar/editorPayload'

const meeting = calendarEventTypes[0] as CalendarEventTypeDefinition
const visit: CalendarEventTypeDefinition = {
  ...meeting,
  key: 'visit',
  label: 'Visit',
  behavior: { ...meeting.behavior, baseKind: 'event', order: 50 },
}

beforeEach(resetCalendarEventTypeRegistryForTests)

describe('calendar event type contracts', () => {
  it('keeps the six shipped behaviors immutable and uses closed schemas', () => {
    expect(calendarEventTypes.map((definition) => definition.key)).toEqual(['meeting', 'call', 'email', 'note', 'event', 'task'])
    expect(Object.isFrozen(calendarEventTypes[0]?.behavior.fields)).toBe(true)
    expect(() => calendarEventTypeBehaviorSchema.parse({ ...meeting.behavior, unexpected: true })).toThrow()
    expect(() => calendarEventTypeDefinitionSchema.parse({ ...meeting, unexpected: true })).toThrow()
    expect(() => calendarEventTypePatchSchema.parse({ targetEventTypeKey: 'meeting', replaceKey: 'other' })).toThrow()
  })

  it('composes widgets, module configuration and DI patches in tier order', () => {
    registerWidgetCalendarEventTypeContributions([
      { moduleId: 'example', widgetId: 'calendar-visit', definitions: [visit], patches: [{ targetEventTypeKey: 'meeting', replaceLabel: 'Widget meeting', replaceCustomFieldsetIds: ['first', 'shared'] }] },
      { moduleId: 'later', widgetId: 'calendar-patch', patches: [{ targetEventTypeKey: 'meeting', replaceColor: 'later', replaceFields: { allDay: false }, deleteCustomFieldsetIds: ['first'], appendCustomFieldsetIds: ['later', 'shared'] }] },
    ])
    registerCalendarModuleOverrides([{
      moduleId: 'example',
      overrides: { patches: [{ targetEventTypeKey: 'meeting', replaceLabel: 'Customer meeting', replaceFields: { recurrence: false } }] },
    }])
    createCalendarEventTypeRegistry().patch('app', { targetEventTypeKey: 'meeting', replaceIcon: 'app-icon' })

    expect(getCalendarEventTypes().map((definition) => definition.key).slice(0, 3)).toEqual(['meeting', 'visit', 'call'])
    const resolved = resolveCalendarEventType('meeting')
    expect(resolved).toMatchObject({
      label: 'Customer meeting', color: 'later', icon: 'app-icon',
      behavior: { fields: { allDay: false, recurrence: false }, customFieldsetIds: ['shared', 'later'] },
    })
    expect(resolved?.provenance.label.phase).toBe('module')
    expect(resolved?.provenance.color.moduleId).toBe('later')
    expect(resolved?.provenance.icon.phase).toBe('programmatic')
    expect(Object.isFrozen(resolved?.behavior.fields)).toBe(true)
    expect(editorKindOfInteractionType('visit')).toBe('event')
  })

  it('rejects a duplicate base key but preserves the first widget', () => {
    registerWidgetCalendarEventTypeContributions([
      { moduleId: 'first', widgetId: 'first', definitions: [visit] },
      { moduleId: 'second', widgetId: 'second', definitions: [{ ...visit, label: 'Second visit' }] },
    ])
    expect(resolveCalendarEventType('visit')?.label).toBe('Visit')
    expect(getCalendarEventTypeDiagnostics()).toContainEqual({
      code: 'duplicate-definition', key: 'visit', moduleId: 'second', widgetId: 'second', owner: 'first',
    })
  })

  it('rejects malformed widget sources atomically', () => {
    registerWidgetCalendarEventTypeContributions([
      { moduleId: 'bad', widgetId: 'invalid', definitions: [visit], patches: [{ targetEventTypeKey: 'meeting', replaceOrder: -1 }] },
      { moduleId: 'good', widgetId: 'valid', definitions: [visit] },
    ])
    expect(resolveCalendarEventType('visit')?.provenance.key.moduleId).toBe('good')
    expect(getCalendarEventTypeDiagnostics()).toContainEqual({ code: 'invalid-source', moduleId: 'bad', widgetId: 'invalid' })
  })

  it('replaces parse diagnostics on repeated source registration', () => {
    const invalidModule = [{ moduleId: 'app', overrides: { patches: [{ targetEventTypeKey: 'meeting', replaceOrder: -1 }] } }]
    registerCalendarModuleOverrides(invalidModule)
    const initial = getCalendarEventTypeDiagnostics()
    registerCalendarModuleOverrides(invalidModule)
    expect(getCalendarEventTypeDiagnostics()).toEqual(initial)
    registerCalendarModuleOverrides([])
    expect(getCalendarEventTypeDiagnostics()).toEqual([])
  })

  it('drops an entire source when a schema-valid patch makes composition invalid', () => {
    const overflow = {
      targetEventTypeKey: 'meeting',
      replaceCustomFieldsetIds: Array.from({ length: 32 }, (_, index) => `fieldset_${index}`),
      appendCustomFieldsetIds: ['overflow'],
    }
    registerWidgetCalendarEventTypeContributions([
      { moduleId: 'bad', widgetId: 'bad-widget', definitions: [visit], overrides: { meeting: { ...meeting, label: 'Bad meeting' } }, patches: [overflow] },
      { moduleId: 'good', widgetId: 'good-widget', patches: [{ targetEventTypeKey: 'meeting', replaceLabel: 'Good meeting' }] },
    ])
    expect(resolveCalendarEventType('visit')).toBeUndefined()
    expect(resolveCalendarEventType('meeting')?.label).toBe('Good meeting')
    expect(getCalendarEventTypeDiagnostics()).toContainEqual({ code: 'invalid-source', key: 'meeting', moduleId: 'bad', widgetId: 'bad-widget' })
    const replacement = createCalendarEventTypeRegistry()
    replacement.upsert('replacement', visit)
    expect(resolveCalendarEventType('visit')?.provenance.key.moduleId).toBe('replacement')
    replacement.removeSource('replacement')

    registerCalendarModuleOverrides([{
      moduleId: 'bad-module', overrides: { eventTypes: { note: null }, patches: [overflow] },
    }])
    expect(resolveCalendarEventType('note')).toBeDefined()
    expect(getCalendarEventTypeDiagnostics()).toContainEqual({ code: 'invalid-source', key: 'meeting', moduleId: 'bad-module' })

    resetCalendarEventTypeRegistryForTests()
    const registry = createCalendarEventTypeRegistry()
    registry.upsert('bad-di', visit)
    registry.patch('bad-di', overflow)
    expect(resolveCalendarEventType('visit')).toBeUndefined()
    expect(getCalendarEventTypeDiagnostics()).toContainEqual({ code: 'invalid-source', key: 'meeting', moduleId: 'bad-di' })
  })

  it('supports tombstones and historical fallback without rewriting keys', () => {
    registerCalendarModuleOverrides([{ moduleId: 'example', overrides: { eventTypes: { note: null } } }])
    expect(resolveCalendarEventType('note')).toBeUndefined()
    expect(resolveCalendarEventType('note', { includeHistorical: true })).toMatchObject({
      key: 'note', historical: true, fallbackReason: 'tombstoned', behavior: { baseKind: 'note', selectable: false },
    })
    registerCalendarModuleOverrides([])
    expect(resolveCalendarEventType('note')?.behavior.selectable).toBe(true)
    registerWidgetCalendarEventTypeContributions([{ moduleId: 'example', widgetId: 'visit', definitions: [visit] }])
    registerWidgetCalendarEventTypeContributions([])
    expect(resolveCalendarEventType('visit', { includeHistorical: true })).toMatchObject({
      key: 'visit', fallbackReason: 'module-unavailable', behavior: { baseKind: 'event', selectable: false },
    })
  })

  it('uses source-owned, idempotent DI operations and reveals lower tiers on removal', () => {
    const registry = createCalendarEventTypeRegistry()
    registerCalendarModuleOverrides([{ moduleId: 'example', overrides: { eventTypes: { note: null } } }])
    registry.replace('app', 'note', { ...meeting, key: 'note' })
    expect(resolveCalendarEventType('note')).toBeDefined()
    registry.remove('app', 'note')
    expect(resolveCalendarEventType('note')).toBeUndefined()
    registry.upsert('app', visit)
    const version = getCalendarEventTypeRegistryVersion()
    registry.upsert('app', visit)
    expect(getCalendarEventTypeRegistryVersion()).toBe(version)
    registry.patch('app', { targetEventTypeKey: 'visit', replaceLabel: 'Field visit' })
    expect(resolveCalendarEventType('visit')?.label).toBe('Field visit')
    registry.removeSource('app')
    expect(resolveCalendarEventType('visit')).toBeUndefined()
    expect(registry.snapshot().version).toBeGreaterThan(version)
    expect(() => registry.upsert('app', meeting)).toThrow('owned by')
  })
})
