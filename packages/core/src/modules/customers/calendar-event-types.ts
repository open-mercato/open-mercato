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

export const calendarEventTypePatchSchema = z.strictObject({
  targetEventTypeKey: calendarEventTypeKeySchema,
  replaceLabel: z.string().trim().min(1).max(150).optional(),
  replaceLabelKey: z.string().trim().min(1).max(200).nullable().optional(),
  replaceIcon: z.string().trim().max(100).nullable().optional(),
  replaceColor: z.string().trim().max(100).nullable().optional(),
  replaceBaseKind: calendarEventBaseKindSchema.optional(),
  replaceSelectable: z.boolean().optional(),
  replaceOrder: z.number().int().min(0).max(10_000).optional(),
  replaceFields: calendarEventTypeFieldsSchema.partial().strict().optional(),
  replaceAdminConfigurable: z.boolean().optional(),
  replacePanelKey: z.string().trim().min(1).max(150).nullable().optional(),
  replaceCustomFieldsetIds: calendarEventTypeBehaviorSchema.shape.customFieldsetIds.optional(),
  deleteCustomFieldsetIds: calendarEventTypeBehaviorSchema.shape.customFieldsetIds.optional(),
  appendCustomFieldsetIds: calendarEventTypeBehaviorSchema.shape.customFieldsetIds.optional(),
})

export const calendarEventTypeProvenanceSchema = z.strictObject({
  moduleId: z.string().trim().min(1).max(100),
  sourcePath: z.string().trim().min(1).max(500),
  moduleOrder: z.number().int().min(0),
  phase: z.enum(['core', 'widget', 'module', 'programmatic', 'fallback']),
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
export type CalendarEventTypePatch = z.infer<typeof calendarEventTypePatchSchema>
export type CalendarEventTypeProvenance = z.infer<typeof calendarEventTypeProvenanceSchema>
export type CalendarEventTypeTombstone = z.infer<typeof calendarEventTypeTombstoneSchema>
export type CalendarEventTypeHistoricalFallback = z.infer<typeof calendarEventTypeHistoricalFallbackSchema>

export type EffectiveCalendarEventType = Readonly<CalendarEventTypeDefinition & {
  provenance: Readonly<Record<string, CalendarEventTypeProvenance>>
  historical: boolean
  fallbackReason?: CalendarEventTypeHistoricalFallback['reason']
}>

export type CalendarEventPanelCapabilities = Readonly<{
  resourcesEnabled: boolean
  staffEnabled: boolean
}>

export type CalendarEventTypePanelProps = {
  definition: EffectiveCalendarEventType
  panelKey?: string
  mode: 'create' | 'edit'
  values: Readonly<Record<string, unknown>>
  errors: Readonly<Record<string, string | undefined>>
  disabled: boolean
  capabilities: CalendarEventPanelCapabilities
  setValue: (fieldId: string, value: unknown) => void
}

export type CalendarEventTypeDiagnostic = Readonly<{
  code: 'invalid-source' | 'duplicate-definition' | 'unknown-override' | 'unknown-patch'
  key?: string
  moduleId: string
  widgetId?: string
  owner?: string
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

export type CalendarEventTypeWidgetContribution = Readonly<{
  moduleId: string
  widgetId: string
  priority?: number
  definitions?: unknown
  overrides?: unknown
  patches?: unknown
}>

export type CalendarOverrides = Readonly<{
  eventTypes?: Readonly<Record<string, CalendarEventTypeDefinition | null>>
  patches?: readonly CalendarEventTypePatch[]
}>

export type CalendarModuleOverrideEntry = Readonly<{
  moduleId: string
  overrides: CalendarOverrides
}>

type ProgrammaticSource = {
  definitions: Map<string, CalendarEventTypeDefinition>
  overrides: Map<string, CalendarEventTypeDefinition | null>
  patches: Map<string, CalendarEventTypePatch>
}

type RegistryState = {
  widgets: readonly ParsedWidgetContribution[]
  modules: readonly CalendarModuleOverrideEntry[]
  sources: Map<string, ProgrammaticSource>
  historicalDefinitions: Map<string, CalendarEventTypeDefinition>
  version: number
  diagnostics: readonly CalendarEventTypeDiagnostic[]
}

const REGISTRY_KEY = Symbol.for('open-mercato.customers.calendar-event-types.v1')

function getRegistryState(): RegistryState {
  const globalRegistry = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState }
  globalRegistry[REGISTRY_KEY] ??= {
    widgets: Object.freeze([]),
    modules: Object.freeze([]),
    sources: new Map(),
    historicalDefinitions: new Map(),
    version: 0,
    diagnostics: Object.freeze([]),
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

function sourceOf(moduleId: string, sourcePath: string, moduleOrder: number, phase: CalendarEventTypeProvenance['phase']): CalendarEventTypeProvenance {
  return Object.freeze({ moduleId, sourcePath, moduleOrder, phase })
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

const widgetContributionSchema = z.strictObject({
  moduleId: z.string().trim().min(1).max(100),
  widgetId: z.string().trim().min(1).max(200),
  priority: z.number().int().optional(),
  definitions: z.array(calendarEventTypeDefinitionSchema).optional(),
  overrides: z.record(calendarEventTypeKeySchema, calendarEventTypeDefinitionSchema.nullable()).optional(),
  patches: z.array(calendarEventTypePatchSchema).optional(),
}).superRefine((entry, context) => {
  const keys = new Set<string>()
  for (const definition of entry.definitions ?? []) {
    if (keys.has(definition.key)) {
      context.addIssue({ code: 'custom', message: 'Duplicate source definition', path: ['definitions'] })
    }
    keys.add(definition.key)
  }
  for (const [key, definition] of Object.entries(entry.overrides ?? {})) {
    if (definition !== null && definition.key !== key) {
      context.addIssue({ code: 'custom', message: 'Replacement key must match target key', path: ['overrides', key] })
    }
  }
})

type ParsedWidgetContribution = z.infer<typeof widgetContributionSchema>

const moduleOverrideEntrySchema = z.strictObject({
  moduleId: z.string().trim().min(1).max(100),
  overrides: z.strictObject({
    eventTypes: z.record(calendarEventTypeKeySchema, calendarEventTypeDefinitionSchema.nullable()).optional(),
    patches: z.array(calendarEventTypePatchSchema).optional(),
  }),
}).superRefine((entry, context) => {
  for (const [key, definition] of Object.entries(entry.overrides.eventTypes ?? {})) {
    if (definition !== null && definition.key !== key) {
      context.addIssue({ code: 'custom', message: 'Replacement key must match target key', path: ['overrides', 'eventTypes', key] })
    }
  }
})

function copyDefinition(definition: CalendarEventTypeDefinition): CalendarEventTypeDefinition {
  return calendarEventTypeDefinitionSchema.parse(definition)
}

function copyPatch(patch: CalendarEventTypePatch): CalendarEventTypePatch {
  return calendarEventTypePatchSchema.parse(patch)
}

function programmaticSource(sourceId: string): ProgrammaticSource {
  return getRegistryState().sources.get(sourceId) ?? {
    definitions: new Map(),
    overrides: new Map(),
    patches: new Map(),
  }
}

function replaceProgrammaticSource(sourceId: string, source: ProgrammaticSource): void {
  const state = getRegistryState()
  archiveCurrentDefinitions()
  state.sources.set(sourceId, source)
  state.version += 1
}

function markDefinitionProvenance(
  definition: CalendarEventTypeDefinition,
  source: CalendarEventTypeProvenance,
): Record<string, CalendarEventTypeProvenance> {
  return Object.fromEntries(allPropertyPaths(definition).map((path) => [path, source]))
}

function applyPatch(
  definition: CalendarEventTypeDefinition,
  patch: CalendarEventTypePatch,
  provenance: Record<string, CalendarEventTypeProvenance>,
  source: CalendarEventTypeProvenance,
): CalendarEventTypeDefinition {
  const next: CalendarEventTypeDefinition = {
    ...definition,
    behavior: { ...definition.behavior, fields: { ...definition.behavior.fields }, customFieldsetIds: [...definition.behavior.customFieldsetIds] },
  }
  if (patch.replaceLabel !== undefined) { next.label = patch.replaceLabel; provenance.label = source }
  if (patch.replaceLabelKey !== undefined) { next.labelKey = patch.replaceLabelKey ?? undefined; provenance.labelKey = source }
  if (patch.replaceIcon !== undefined) { next.icon = patch.replaceIcon; provenance.icon = source }
  if (patch.replaceColor !== undefined) { next.color = patch.replaceColor; provenance.color = source }
  if (patch.replaceAdminConfigurable !== undefined) { next.adminConfigurable = patch.replaceAdminConfigurable; provenance.adminConfigurable = source }
  if (patch.replacePanelKey !== undefined) { next.panelKey = patch.replacePanelKey ?? undefined; provenance.panelKey = source }
  if (patch.replaceBaseKind !== undefined) { next.behavior.baseKind = patch.replaceBaseKind; provenance['behavior.baseKind'] = source }
  if (patch.replaceSelectable !== undefined) { next.behavior.selectable = patch.replaceSelectable; provenance['behavior.selectable'] = source }
  if (patch.replaceOrder !== undefined) { next.behavior.order = patch.replaceOrder; provenance['behavior.order'] = source }
  if (patch.replaceFields) {
    next.behavior.fields = { ...next.behavior.fields, ...patch.replaceFields }
    for (const field of Object.keys(patch.replaceFields)) provenance[`behavior.fields.${field}`] = source
  }
  if (patch.replaceCustomFieldsetIds || patch.deleteCustomFieldsetIds || patch.appendCustomFieldsetIds) {
    const fieldsets = patch.replaceCustomFieldsetIds ?? next.behavior.customFieldsetIds
    const deleted = new Set(patch.deleteCustomFieldsetIds ?? [])
    next.behavior.customFieldsetIds = [...new Set([...fieldsets.filter((id) => !deleted.has(id)), ...(patch.appendCustomFieldsetIds ?? [])])]
    provenance['behavior.customFieldsetIds'] = source
  }
  return calendarEventTypeDefinitionSchema.parse(next)
}

function compose(excludedSources: ReadonlySet<object> = new Set(), rejectedSources: readonly CalendarEventTypeDiagnostic[] = []): {
  items: readonly EffectiveCalendarEventType[]
  tombstones: readonly CalendarEventTypeTombstone[]
  diagnostics: readonly CalendarEventTypeDiagnostic[]
} {
  const definitions = new Map<string, CalendarEventTypeDefinition>()
  const owners = new Map<string, CalendarEventTypeProvenance>()
  const provenance = new Map<string, Record<string, CalendarEventTypeProvenance>>()
  const tombstones = new Map<string, CalendarEventTypeTombstone>()
  const diagnostics: CalendarEventTypeDiagnostic[] = [...getRegistryState().diagnostics, ...rejectedSources]
  const coreSource = Object.freeze({ moduleId: 'customers', sourcePath: 'calendar-event-types.ts', moduleOrder: 0, phase: 'core' as const })

  for (const definition of calendarEventTypes) {
    definitions.set(definition.key, definition)
    owners.set(definition.key, coreSource)
    provenance.set(definition.key, markDefinitionProvenance(definition, coreSource))
  }
  const state = getRegistryState()
  const widgets = state.widgets.map((entry, moduleOrder) => ({ entry, moduleOrder })).filter(({ entry }) => !excludedSources.has(entry))
  const modules = state.modules.map((entry, moduleOrder) => ({ entry, moduleOrder })).filter(({ entry }) => !excludedSources.has(entry))
  const programmatic = [...state.sources.entries()].filter(([, contribution]) => !excludedSources.has(contribution))

  for (const { entry, moduleOrder } of widgets) {
    const source = sourceOf(entry.moduleId, `widgets/injection/${entry.widgetId}/widget.ts`, moduleOrder, 'widget')
    for (const definition of entry.definitions ?? []) {
      const existing = owners.get(definition.key)
      if (existing) {
        diagnostics.push({ code: 'duplicate-definition', key: definition.key, moduleId: entry.moduleId, widgetId: entry.widgetId, owner: existing.moduleId })
        continue
      }
      definitions.set(definition.key, definition)
      owners.set(definition.key, source)
      provenance.set(definition.key, markDefinitionProvenance(definition, source))
    }
  }
  for (const [sourceId, contribution] of programmatic) {
    const source = sourceOf(sourceId, `di:${sourceId}`, 0, 'programmatic')
    for (const definition of contribution.definitions.values()) {
      const existing = owners.get(definition.key)
      if (existing && existing.moduleId !== sourceId) {
        diagnostics.push({ code: 'duplicate-definition', key: definition.key, moduleId: sourceId, owner: existing.moduleId })
        continue
      }
      definitions.set(definition.key, definition)
      owners.set(definition.key, source)
      provenance.set(definition.key, markDefinitionProvenance(definition, source))
    }
  }

  const applyOverrides = (
    overrides: Readonly<Record<string, CalendarEventTypeDefinition | null>>,
    source: CalendarEventTypeProvenance,
    widgetId?: string,
  ): void => {
    for (const [key, override] of Object.entries(overrides)) {
      if (!definitions.has(key)) {
        if (override === null) {
          diagnostics.push({ code: 'unknown-override', key, moduleId: source.moduleId, widgetId })
          continue
        }
        diagnostics.push({ code: 'unknown-override', key, moduleId: source.moduleId, widgetId })
      }
      if (override === null) {
        tombstones.set(key, deepFreeze({ key, provenance: source }))
      } else {
        definitions.set(key, override)
        owners.set(key, source)
        provenance.set(key, markDefinitionProvenance(override, source))
        tombstones.delete(key)
      }
    }
  }
  for (const { entry, moduleOrder } of widgets) {
    applyOverrides(entry.overrides ?? {}, sourceOf(entry.moduleId, `widgets/injection/${entry.widgetId}/widget.ts`, moduleOrder, 'widget'), entry.widgetId)
  }
  for (const { entry, moduleOrder } of modules) {
    applyOverrides(entry.overrides.eventTypes ?? {}, sourceOf(entry.moduleId, 'modules.ts', moduleOrder, 'module'))
  }
  for (const [sourceId, contribution] of programmatic) {
    applyOverrides(Object.fromEntries(contribution.overrides), sourceOf(sourceId, `di:${sourceId}`, 0, 'programmatic'))
  }

  const applyPatches = (patches: readonly CalendarEventTypePatch[], source: CalendarEventTypeProvenance, widgetId?: string): CalendarEventTypeDiagnostic | null => {
    for (const patch of patches) {
      const key = patch.targetEventTypeKey
      const definition = definitions.get(key)
      if (!definition || tombstones.has(key)) {
        diagnostics.push({ code: 'unknown-patch', key, moduleId: source.moduleId, widgetId })
        continue
      }
      const propertyProvenance = { ...provenance.get(key) }
      try {
        const patched = applyPatch(definition, patch, propertyProvenance, source)
        definitions.set(key, patched)
        provenance.set(key, propertyProvenance)
      } catch {
        return { code: 'invalid-source', key, moduleId: source.moduleId, widgetId }
      }
    }
    return null
  }
  for (const { entry, moduleOrder } of widgets) {
    const failure = applyPatches(entry.patches ?? [], sourceOf(entry.moduleId, `widgets/injection/${entry.widgetId}/widget.ts`, moduleOrder, 'widget'), entry.widgetId)
    if (failure) return compose(new Set([...excludedSources, entry]), [...rejectedSources, failure])
  }
  for (const { entry, moduleOrder } of modules) {
    const failure = applyPatches(entry.overrides.patches ?? [], sourceOf(entry.moduleId, 'modules.ts', moduleOrder, 'module'))
    if (failure) return compose(new Set([...excludedSources, entry]), [...rejectedSources, failure])
  }
  for (const [sourceId, contribution] of programmatic) {
    const failure = applyPatches([...contribution.patches.values()], sourceOf(sourceId, `di:${sourceId}`, 0, 'programmatic'))
    if (failure) return compose(new Set([...excludedSources, contribution]), [...rejectedSources, failure])
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

export function registerWidgetCalendarEventTypeContributions(entries: readonly CalendarEventTypeWidgetContribution[]): void {
  const state = getRegistryState()
  const diagnostics: CalendarEventTypeDiagnostic[] = []
  const parsed: ParsedWidgetContribution[] = []
  for (const entry of entries) {
    const result = widgetContributionSchema.safeParse(entry)
    if (result.success) parsed.push(result.data)
    else diagnostics.push({ code: 'invalid-source', moduleId: entry.moduleId, widgetId: entry.widgetId })
  }
  const moduleOrder = new Map<string, number>()
  entries.forEach((entry) => { if (!moduleOrder.has(entry.moduleId)) moduleOrder.set(entry.moduleId, moduleOrder.size) })
  parsed.sort((left, right) => (moduleOrder.get(left.moduleId) ?? 0) - (moduleOrder.get(right.moduleId) ?? 0)
    || (left.priority ?? 0) - (right.priority ?? 0) || left.widgetId.localeCompare(right.widgetId))
  const moduleDiagnostics = state.diagnostics.filter((diagnostic) => !diagnostic.widgetId)
  if (JSON.stringify(state.widgets) === JSON.stringify(parsed)
    && JSON.stringify(state.diagnostics.filter((diagnostic) => diagnostic.widgetId)) === JSON.stringify(diagnostics)) return
  archiveCurrentDefinitions()
  state.widgets = deepFreeze(parsed)
  state.diagnostics = deepFreeze([...diagnostics, ...moduleDiagnostics])
  state.version += 1
}

export function registerCalendarModuleOverrides(entries: readonly CalendarModuleOverrideEntry[]): void {
  const state = getRegistryState()
  const diagnostics: CalendarEventTypeDiagnostic[] = []
  const parsed: CalendarModuleOverrideEntry[] = []
  for (const entry of entries) {
    const result = moduleOverrideEntrySchema.safeParse(entry)
    if (result.success) parsed.push(result.data)
    else diagnostics.push({ code: 'invalid-source', moduleId: entry.moduleId })
  }
  const widgetDiagnostics = state.diagnostics.filter((diagnostic) => diagnostic.widgetId)
  if (JSON.stringify(state.modules) === JSON.stringify(parsed)
    && JSON.stringify(state.diagnostics.filter((diagnostic) => !diagnostic.widgetId)) === JSON.stringify(diagnostics)) return
  archiveCurrentDefinitions()
  state.modules = deepFreeze(parsed)
  state.diagnostics = deepFreeze([...widgetDiagnostics, ...diagnostics])
  state.version += 1
}

export type CalendarEventTypeRegistrySnapshot = Readonly<{
  version: number
  items: readonly EffectiveCalendarEventType[]
  tombstones: readonly CalendarEventTypeTombstone[]
  diagnostics: readonly CalendarEventTypeDiagnostic[]
}>

export interface CalendarEventTypeRegistry {
  upsert(sourceId: string, definition: CalendarEventTypeDefinition): void
  replace(sourceId: string, key: string, definition: CalendarEventTypeDefinition | null): void
  patch(sourceId: string, patch: CalendarEventTypePatch): void
  remove(sourceId: string, key: string): void
  removeSource(sourceId: string): void
  snapshot(): CalendarEventTypeRegistrySnapshot
}

function validatedSourceId(sourceId: string): string {
  return z.string().trim().min(1).max(100).parse(sourceId)
}

function baseOwnerOf(key: string): string | undefined {
  if (calendarEventTypes.some((definition) => definition.key === key)) return 'customers'
  const invalidSources = compose().diagnostics.filter((diagnostic) => diagnostic.code === 'invalid-source')
  for (const widget of getRegistryState().widgets) {
    if (invalidSources.some((diagnostic) => diagnostic.moduleId === widget.moduleId && diagnostic.widgetId === widget.widgetId)) continue
    if (widget.definitions?.some((definition) => definition.key === key)) return widget.moduleId
  }
  for (const [sourceId, contribution] of getRegistryState().sources) {
    if (invalidSources.some((diagnostic) => diagnostic.moduleId === sourceId && !diagnostic.widgetId)) continue
    if (contribution.definitions.has(key)) return sourceId
  }
  return compose().items.find((definition) => definition.key === key)?.provenance.key?.moduleId
}

export function createCalendarEventTypeRegistry(): CalendarEventTypeRegistry {
  return {
    upsert(sourceId, definition) {
      const id = validatedSourceId(sourceId)
      const nextDefinition = copyDefinition(definition)
      const owner = baseOwnerOf(nextDefinition.key)
      if (owner && owner !== id) {
        throw new Error(`[internal] Calendar event type "${nextDefinition.key}" is owned by "${owner}"`)
      }
      const current = programmaticSource(id)
      if (JSON.stringify(current.definitions.get(nextDefinition.key)) === JSON.stringify(nextDefinition)) return
      replaceProgrammaticSource(id, { ...current, definitions: new Map(current.definitions).set(nextDefinition.key, nextDefinition) })
    },
    replace(sourceId, key, definition) {
      const id = validatedSourceId(sourceId)
      const parsedKey = calendarEventTypeKeySchema.parse(key)
      const nextDefinition = definition === null ? null : copyDefinition(definition)
      if (nextDefinition && nextDefinition.key !== parsedKey) throw new Error('[internal] Replacement key must match target key')
      const current = programmaticSource(id)
      if (JSON.stringify(current.overrides.get(parsedKey)) === JSON.stringify(nextDefinition)) return
      replaceProgrammaticSource(id, { ...current, overrides: new Map(current.overrides).set(parsedKey, nextDefinition) })
    },
    patch(sourceId, patch) {
      const id = validatedSourceId(sourceId)
      const nextPatch = copyPatch(patch)
      const current = programmaticSource(id)
      if (JSON.stringify(current.patches.get(nextPatch.targetEventTypeKey)) === JSON.stringify(nextPatch)) return
      replaceProgrammaticSource(id, { ...current, patches: new Map(current.patches).set(nextPatch.targetEventTypeKey, nextPatch) })
    },
    remove(sourceId, key) {
      const id = validatedSourceId(sourceId)
      const parsedKey = calendarEventTypeKeySchema.parse(key)
      const current = getRegistryState().sources.get(id)
      if (!current || !(current.definitions.has(parsedKey) || current.overrides.has(parsedKey) || current.patches.has(parsedKey))) return
      const next = { definitions: new Map(current.definitions), overrides: new Map(current.overrides), patches: new Map(current.patches) }
      next.definitions.delete(parsedKey)
      next.overrides.delete(parsedKey)
      next.patches.delete(parsedKey)
      replaceProgrammaticSource(id, next)
    },
    removeSource(sourceId) {
      const id = validatedSourceId(sourceId)
      const state = getRegistryState()
      if (!state.sources.has(id)) return
      archiveCurrentDefinitions()
      state.sources.delete(id)
      state.version += 1
    },
    snapshot() {
      const state = getRegistryState()
      return deepFreeze({ version: state.version, ...compose() })
    },
  }
}

export function getCalendarEventTypeRegistryVersion(): number {
  return getRegistryState().version
}

export function getCalendarEventTypes(): readonly EffectiveCalendarEventType[] {
  return compose().items
}

export function resolveCalendarEventTypes(): readonly EffectiveCalendarEventType[] {
  return getCalendarEventTypes()
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
  state.widgets = Object.freeze([])
  state.modules = Object.freeze([])
  state.sources.clear()
  state.historicalDefinitions.clear()
  state.version = 0
  state.diagnostics = Object.freeze([])
}
