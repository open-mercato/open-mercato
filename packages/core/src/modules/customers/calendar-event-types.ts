import { z } from 'zod'

export const calendarEventBaseKindSchema = z.enum(['meeting', 'call', 'email', 'note', 'event', 'task'])

export const calendarEventTypeFieldsSchema = z.strictObject({
  endTime: z.boolean(),
  allDay: z.boolean(),
  recurrence: z.boolean(),
  location: z.enum(['none', 'location', 'phoneLink']),
  people: z.enum(['none', 'attendees', 'participants', 'recipients', 'assignee']),
  priority: z.boolean(),
  resources: z.boolean(),
})

export const calendarEventTypeBehaviorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baseKind: calendarEventBaseKindSchema,
  selectable: z.boolean(),
  order: z.number().int().min(0).max(10_000),
  fields: calendarEventTypeFieldsSchema,
  customFieldsetIds: z.array(z.string().trim().min(1).max(100)).max(32).refine(
    (values) => new Set(values).size === values.length,
    'Custom fieldset ids must be unique',
  ),
})

export const calendarEventTypeKeySchema = z.string().trim().min(1).max(150).regex(
  /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/,
  'Calendar event type keys must be lowercase dictionary keys',
)

export const calendarEventTypeDefinitionSchema = z.strictObject({
  key: calendarEventTypeKeySchema,
  label: z.string().trim().min(1).max(150),
  labelKey: z.string().trim().min(1).max(200).optional(),
  icon: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(100).nullable().optional(),
  behavior: calendarEventTypeBehaviorSchema,
  adminConfigurable: z.boolean().optional(),
  panelKey: z.string().trim().min(1).max(150).optional(),
})

export const calendarEventTypeBehaviorOverrideSchema = z.strictObject({
  schemaVersion: z.literal(1).optional(),
  baseKind: calendarEventBaseKindSchema.optional(),
  selectable: z.boolean().optional(),
  order: z.number().int().min(0).max(10_000).optional(),
  fields: calendarEventTypeFieldsSchema.partial().strict().optional(),
  customFieldsetIds: z.array(z.string().trim().min(1).max(100)).max(32).refine(
    (values) => new Set(values).size === values.length,
    'Custom fieldset ids must be unique',
  ).optional(),
})

export const calendarEventTypeDefinitionOverrideSchema = z.strictObject({
  label: z.string().trim().min(1).max(150).optional(),
  labelKey: z.string().trim().min(1).max(200).optional(),
  icon: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(100).nullable().optional(),
  behavior: calendarEventTypeBehaviorOverrideSchema.optional(),
  adminConfigurable: z.boolean().optional(),
  panelKey: z.string().trim().min(1).max(150).optional(),
})

export const calendarEventTypeProvenanceSchema = z.strictObject({
  moduleId: z.string().trim().min(1).max(100),
  sourcePath: z.string().trim().min(1).max(500),
  moduleOrder: z.number().int().min(0),
  phase: z.enum(['core', 'definition', 'override', 'programmatic', 'fallback']),
})

export const normalizedCalendarEventTypeEntrySchema = z.strictObject({
  moduleId: z.string().trim().min(1).max(100),
  sourcePath: z.string().trim().min(1).max(500),
  moduleOrder: z.number().int().min(0),
  definitions: z.array(calendarEventTypeDefinitionSchema),
  overrides: z.record(z.string(), calendarEventTypeDefinitionOverrideSchema.nullable()),
})

export const calendarEventTypeTombstoneSchema = z.strictObject({
  key: calendarEventTypeKeySchema,
  provenance: calendarEventTypeProvenanceSchema,
})

export const calendarEventTypeHistoricalFallbackSchema = z.strictObject({
  key: calendarEventTypeKeySchema,
  reason: z.enum(['tombstoned', 'module-unavailable', 'unknown']),
  definition: calendarEventTypeDefinitionSchema,
})

export type CalendarEventBaseKind = z.infer<typeof calendarEventBaseKindSchema>
export type CalendarEventTypeFields = z.infer<typeof calendarEventTypeFieldsSchema>
export type CalendarEventTypeBehavior = z.infer<typeof calendarEventTypeBehaviorSchema>
export type CalendarEventTypeDefinition = z.infer<typeof calendarEventTypeDefinitionSchema>
export type CalendarEventTypeBehaviorOverride = z.infer<typeof calendarEventTypeBehaviorOverrideSchema>
export type CalendarEventTypeDefinitionOverride = z.infer<typeof calendarEventTypeDefinitionOverrideSchema>
export type CalendarEventTypeProvenance = z.infer<typeof calendarEventTypeProvenanceSchema>
export type NormalizedCalendarEventTypeEntry = z.infer<typeof normalizedCalendarEventTypeEntrySchema>
export type CalendarEventTypeTombstone = z.infer<typeof calendarEventTypeTombstoneSchema>
export type CalendarEventTypeHistoricalFallback = z.infer<typeof calendarEventTypeHistoricalFallbackSchema>

export type EffectiveCalendarEventType = Readonly<CalendarEventTypeDefinition & {
  provenance: Readonly<Record<string, CalendarEventTypeProvenance>>
  historical: boolean
  fallbackReason?: CalendarEventTypeHistoricalFallback['reason']
}>

export type CalendarEventTypeDiagnostic = Readonly<{
  code: 'unknown-override'
  key: string
  moduleId: string
}>

const behavior = (
  baseKind: CalendarEventBaseKind,
  order: number,
  fields: CalendarEventTypeFields,
): CalendarEventTypeBehavior => ({
  schemaVersion: 1,
  baseKind,
  selectable: true,
  order,
  fields,
  customFieldsetIds: [],
})

const resources = true

export const calendarEventTypes: readonly CalendarEventTypeDefinition[] = deepFreeze([
  { key: 'meeting', label: 'Meeting', labelKey: 'customers.calendar.editor.types.meeting', icon: 'lucide:users', color: '#f59e0b', behavior: behavior('meeting', 0, { endTime: true, allDay: true, recurrence: true, location: 'location', people: 'attendees', priority: false, resources }) },
  { key: 'call', label: 'Call', labelKey: 'customers.calendar.editor.types.call', icon: 'lucide:phone-call', color: '#2563eb', behavior: behavior('call', 100, { endTime: false, allDay: true, recurrence: true, location: 'phoneLink', people: 'participants', priority: false, resources }) },
  { key: 'email', label: 'Email', labelKey: 'customers.calendar.editor.types.email', icon: 'lucide:mail', color: '#16a34a', behavior: behavior('email', 200, { endTime: false, allDay: true, recurrence: true, location: 'none', people: 'recipients', priority: false, resources }) },
  { key: 'note', label: 'Note', labelKey: 'customers.calendar.editor.types.note', icon: 'lucide:notebook', color: '#a855f7', behavior: behavior('note', 300, { endTime: false, allDay: false, recurrence: false, location: 'none', people: 'none', priority: false, resources }) },
  { key: 'event', label: 'Event', labelKey: 'customers.calendar.editor.types.event', icon: 'lucide:calendar', color: '#6366f1', behavior: behavior('event', 400, { endTime: true, allDay: true, recurrence: true, location: 'location', people: 'attendees', priority: false, resources }) },
  { key: 'task', label: 'Task', labelKey: 'customers.calendar.editor.types.task', icon: 'lucide:check-square', color: '#ef4444', behavior: behavior('task', 500, { endTime: false, allDay: true, recurrence: true, location: 'none', people: 'assignee', priority: true, resources }) },
])

export const calendarEventTypeOverrides: Readonly<Record<string, CalendarEventTypeDefinitionOverride | null>> = Object.freeze({})

type RegistryState = {
  generatedEntries: readonly NormalizedCalendarEventTypeEntry[]
  programmaticEntries: readonly NormalizedCalendarEventTypeEntry[]
  historicalDefinitions: Map<string, CalendarEventTypeDefinition>
}

const REGISTRY_KEY = Symbol.for('open-mercato.customers.calendar-event-types.v1')

function getRegistryState(): RegistryState {
  const globalRegistry = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState }
  globalRegistry[REGISTRY_KEY] ??= {
    generatedEntries: Object.freeze([]),
    programmaticEntries: Object.freeze([]),
    historicalDefinitions: new Map(),
  }
  return globalRegistry[REGISTRY_KEY]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function sourceOf(entry: NormalizedCalendarEventTypeEntry, phase: CalendarEventTypeProvenance['phase']): CalendarEventTypeProvenance {
  return Object.freeze({ moduleId: entry.moduleId, sourcePath: entry.sourcePath, moduleOrder: entry.moduleOrder, phase })
}

function allPropertyPaths(definition: CalendarEventTypeDefinition): string[] {
  const paths = ['key', 'label', 'behavior.schemaVersion', 'behavior.baseKind', 'behavior.selectable', 'behavior.order']
  if (definition.labelKey !== undefined) paths.push('labelKey')
  if (definition.icon !== undefined) paths.push('icon')
  if (definition.color !== undefined) paths.push('color')
  if (definition.adminConfigurable !== undefined) paths.push('adminConfigurable')
  if (definition.panelKey !== undefined) paths.push('panelKey')
  for (const key of Object.keys(definition.behavior.fields)) paths.push(`behavior.fields.${key}`)
  paths.push('behavior.customFieldsetIds')
  return paths
}

function normalizeEntry(entry: NormalizedCalendarEventTypeEntry): NormalizedCalendarEventTypeEntry {
  const parsed = normalizedCalendarEventTypeEntrySchema.parse(entry)
  const overrides: Record<string, CalendarEventTypeDefinitionOverride | null> = {}
  for (const [rawKey, override] of Object.entries(parsed.overrides)) {
    overrides[calendarEventTypeKeySchema.parse(rawKey)] = override
  }
  return deepFreeze({ ...parsed, overrides })
}

function normalizeEntries(entries: readonly NormalizedCalendarEventTypeEntry[]): readonly NormalizedCalendarEventTypeEntry[] {
  const normalized = entries.map(normalizeEntry)
  normalized.sort((left, right) => left.moduleOrder - right.moduleOrder || left.moduleId.localeCompare(right.moduleId))
  return deepFreeze(normalized)
}

function applyOverride(
  definition: CalendarEventTypeDefinition,
  provenance: Record<string, CalendarEventTypeProvenance>,
  override: CalendarEventTypeDefinitionOverride,
  source: CalendarEventTypeProvenance,
): CalendarEventTypeDefinition {
  const next: CalendarEventTypeDefinition = {
    ...definition,
    ...override,
    behavior: {
      ...definition.behavior,
      ...override.behavior,
      fields: {
        ...definition.behavior.fields,
        ...override.behavior?.fields,
      },
    },
  }
  for (const key of ['label', 'labelKey', 'icon', 'color', 'adminConfigurable', 'panelKey'] as const) {
    if (key in override) provenance[key] = source
  }
  if (override.behavior) {
    for (const key of ['schemaVersion', 'baseKind', 'selectable', 'order', 'customFieldsetIds'] as const) {
      if (key in override.behavior) provenance[`behavior.${key}`] = source
    }
    for (const key of Object.keys(override.behavior.fields ?? {})) provenance[`behavior.fields.${key}`] = source
  }
  return calendarEventTypeDefinitionSchema.parse(next)
}

function compose(): {
  items: readonly EffectiveCalendarEventType[]
  tombstones: readonly CalendarEventTypeTombstone[]
  diagnostics: readonly CalendarEventTypeDiagnostic[]
} {
  const definitions = new Map<string, CalendarEventTypeDefinition>()
  const owners = new Map<string, CalendarEventTypeProvenance>()
  const provenance = new Map<string, Record<string, CalendarEventTypeProvenance>>()
  const tombstones = new Map<string, CalendarEventTypeTombstone>()
  const diagnostics: CalendarEventTypeDiagnostic[] = []
  const coreSource = Object.freeze({ moduleId: 'customers', sourcePath: 'calendar-event-types.ts', moduleOrder: 0, phase: 'core' as const })

  for (const definition of calendarEventTypes) {
    definitions.set(definition.key, definition)
    owners.set(definition.key, coreSource)
    provenance.set(definition.key, Object.fromEntries(allPropertyPaths(definition).map((path) => [path, coreSource])))
  }

  const generated = getRegistryState().generatedEntries
  const programmatic = getRegistryState().programmaticEntries
  const phases: Array<{ entries: readonly NormalizedCalendarEventTypeEntry[]; programmatic: boolean }> = [
    { entries: generated, programmatic: false },
    { entries: programmatic, programmatic: true },
  ]
  for (const phase of phases) {
    for (const entry of phase.entries) {
      const source = sourceOf(entry, phase.programmatic ? 'programmatic' : 'definition')
      for (const definition of entry.definitions) {
        const existing = owners.get(definition.key)
        if (existing) {
          throw new Error(`[internal] Duplicate calendar event type "${definition.key}" from modules "${existing.moduleId}" and "${entry.moduleId}"`)
        }
        definitions.set(definition.key, definition)
        owners.set(definition.key, source)
        provenance.set(definition.key, Object.fromEntries(allPropertyPaths(definition).map((path) => [path, source])))
      }
    }
    for (const entry of phase.entries) {
      const source = sourceOf(entry, phase.programmatic ? 'programmatic' : 'override')
      for (const [key, override] of Object.entries(entry.overrides)) {
        const definition = definitions.get(key)
        if (!definition) {
          diagnostics.push(Object.freeze({ code: 'unknown-override', key, moduleId: entry.moduleId }))
          continue
        }
        if (override === null) {
          tombstones.set(key, deepFreeze({ key, provenance: source }))
          continue
        }
        const propertyProvenance = provenance.get(key) ?? {}
        definitions.set(key, applyOverride(definition, propertyProvenance, override, source))
        provenance.set(key, propertyProvenance)
        tombstones.delete(key)
      }
    }
  }

  const items = [...definitions.values()]
    .filter((definition) => !tombstones.has(definition.key))
    .map((definition) => deepFreeze({
      ...definition,
      provenance: Object.freeze({ ...(provenance.get(definition.key) ?? {}) }),
      historical: false,
    }))
    .sort((left, right) => left.behavior.order - right.behavior.order || left.key.localeCompare(right.key))
  return deepFreeze({ items, tombstones: [...tombstones.values()], diagnostics })
}

function archiveCurrentDefinitions(): void {
  const state = getRegistryState()
  for (const item of compose().items) {
    const { provenance: _provenance, historical: _historical, fallbackReason: _fallbackReason, ...definition } = item
    state.historicalDefinitions.set(item.key, deepFreeze(definition))
  }
}

export function registerCalendarEventTypeEntries(entries: readonly NormalizedCalendarEventTypeEntry[]): void {
  archiveCurrentDefinitions()
  const state = getRegistryState()
  const previous = state.generatedEntries
  state.generatedEntries = normalizeEntries(entries)
  try {
    compose()
  } catch (error) {
    state.generatedEntries = previous
    throw error
  }
}

export function registerProgrammaticCalendarEventTypeEntries(entries: readonly NormalizedCalendarEventTypeEntry[]): void {
  archiveCurrentDefinitions()
  const state = getRegistryState()
  const previous = state.programmaticEntries
  state.programmaticEntries = normalizeEntries(entries)
  try {
    compose()
  } catch (error) {
    state.programmaticEntries = previous
    throw error
  }
}

export function getCalendarEventTypes(): readonly EffectiveCalendarEventType[] {
  return compose().items
}

export function getCalendarEventTypeTombstones(): readonly CalendarEventTypeTombstone[] {
  return compose().tombstones
}

export function getCalendarEventTypeDiagnostics(): readonly CalendarEventTypeDiagnostic[] {
  return compose().diagnostics
}

export function resolveCalendarEventType(
  rawKey: string,
  options: { includeHistorical?: boolean } = {},
): EffectiveCalendarEventType | undefined {
  const key = calendarEventTypeKeySchema.parse(rawKey)
  const current = compose()
  const resolved = current.items.find((item) => item.key === key)
  if (resolved || !options.includeHistorical) return resolved

  const stored = getRegistryState().historicalDefinitions.get(key)
  const reason: CalendarEventTypeHistoricalFallback['reason'] = current.tombstones.some((entry) => entry.key === key)
    ? 'tombstoned'
    : stored
      ? 'module-unavailable'
      : 'unknown'
  const definition = stored ?? {
    ...calendarEventTypes[0],
    key,
    label: rawKey,
    labelKey: undefined,
    behavior: { ...calendarEventTypes[0]!.behavior, selectable: false },
  }
  const fallbackSource = Object.freeze({ moduleId: 'customers', sourcePath: 'calendar-event-types.ts', moduleOrder: 0, phase: 'fallback' as const })
  const historicalDefinition = calendarEventTypeDefinitionSchema.parse({
    ...definition,
    behavior: { ...definition.behavior, selectable: false },
  })
  return deepFreeze({
    ...historicalDefinition,
    provenance: Object.fromEntries(allPropertyPaths(historicalDefinition).map((path) => [path, fallbackSource])),
    historical: true,
    fallbackReason: reason,
  })
}

export function resetCalendarEventTypeRegistryForTests(): void {
  const state = getRegistryState()
  state.generatedEntries = Object.freeze([])
  state.programmaticEntries = Object.freeze([])
  state.historicalDefinitions.clear()
}
