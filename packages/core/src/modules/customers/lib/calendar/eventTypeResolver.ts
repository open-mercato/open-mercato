import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { waitForAsyncRegistration } from '@open-mercato/shared/lib/bootstrap/factory'
import {
  getInjectionRegistryVersion,
  loadInjectionWidgetsForSpot,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import {
  calendarEventTypeBehaviorSchema,
  calendarEventTypes,
  getCalendarEventTypes,
  getCalendarEventTypeTombstones,
  resolveCalendarEventType,
  registerWidgetCalendarEventTypeContributions,
  type CalendarEventTypeBehavior,
  type CalendarEventTypeProvenance,
  type EffectiveCalendarEventType,
} from '../../calendar-event-types'
import { CustomerDictionaryEntry } from '../../data/entities'
import { extensionPoints } from '../../extension-points'

export type ScopedCalendarEventType = Readonly<{
  key: string
  label: string
  labelKey?: string
  icon?: string | null
  color?: string | null
  behavior: CalendarEventTypeBehavior
  selectable: boolean
  panelKey?: string
  source: string
  provenance: Readonly<Record<string, CalendarEventTypeProvenance>>
  historical: boolean
  fallbackReason?: 'tombstoned' | 'module-unavailable' | 'unknown'
  adminConfigurable: boolean
  isInherited: boolean
  isLocalOverride: boolean
  updatedAt: string | null
  missingCustomFieldsetIds: readonly string[]
  inactiveDictionaryOverride?: boolean
}>

export type CalendarEventTypeCatalog = Readonly<{
  items: readonly ScopedCalendarEventType[]
  fallbackKey: 'meeting'
}>

type ResolveCalendarEventTypesInput = {
  em: EntityManager
  tenantId: string
  organizationId: string
  readableOrganizationIds: readonly string[]
  availableCustomFieldsetIdsFromEntitiesBoundary?: readonly string[]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function serializeStaticType(type: EffectiveCalendarEventType): ScopedCalendarEventType {
  return deepFreeze({
    key: type.key,
    label: type.label,
    ...(type.labelKey ? { labelKey: type.labelKey } : {}),
    icon: type.icon ?? null,
    color: type.color ?? null,
    behavior: type.behavior,
    selectable: type.behavior.selectable,
    ...(type.panelKey ? { panelKey: type.panelKey } : {}),
    source: type.provenance.key?.moduleId ?? 'customers',
    provenance: type.provenance,
    historical: type.historical,
    ...(type.fallbackReason ? { fallbackReason: type.fallbackReason } : {}),
    adminConfigurable: type.adminConfigurable !== false,
    isInherited: false,
    isLocalOverride: false,
    updatedAt: null,
    missingCustomFieldsetIds: [],
  })
}

export function resolveBaselineCalendarEventTypes(): CalendarEventTypeCatalog {
  const types: readonly EffectiveCalendarEventType[] = getCalendarEventTypes()
  return deepFreeze({ items: types.map(serializeStaticType), fallbackKey: 'meeting' })
}

let loadedWidgetVersion = -1
let loadingWidgets: Promise<void> | null = null

async function ensureCalendarEventTypeWidgetsLoaded(): Promise<void> {
  await waitForAsyncRegistration()
  const version = getInjectionRegistryVersion()
  if (loadedWidgetVersion === version) return
  if (loadingWidgets) return loadingWidgets
  const pending = (async () => {
    const widgets = await loadInjectionWidgetsForSpot(extensionPoints.hosts.calendarEventTypes.spotId)
    registerWidgetCalendarEventTypeContributions(widgets.map((widget) => {
      if (!('eventTypes' in widget)) {
        throw new Error(`[internal] Calendar event type widget ${widget.metadata.id} has no eventTypes payload`)
      }
      return {
        moduleId: widget.moduleId,
        widgetId: widget.metadata.id,
        priority: typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0,
        definitions: widget.eventTypes,
        overrides: 'eventTypeOverrides' in widget ? widget.eventTypeOverrides : undefined,
        patches: 'eventTypePatches' in widget ? widget.eventTypePatches : undefined,
      }
    }))
    loadedWidgetVersion = version
  })()
  loadingWidgets = pending
  try {
    await pending
  } finally {
    if (loadingWidgets === pending) loadingWidgets = null
  }
}

function selectDictionaryRows(
  rows: readonly CustomerDictionaryEntry[],
  organizationId: string,
  readableOrganizationIds: readonly string[],
): Map<string, CustomerDictionaryEntry> {
  const orderedOrganizationIds = Array.from(new Set([organizationId, ...readableOrganizationIds]))
  const rank = new Map(orderedOrganizationIds.map((id, index) => [id, index]))
  const sorted = [...rows].sort((left, right) => {
    const rankDelta = (rank.get(left.organizationId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.organizationId) ?? Number.MAX_SAFE_INTEGER)
    return rankDelta || left.normalizedValue.localeCompare(right.normalizedValue)
  })
  const selected = new Map<string, CustomerDictionaryEntry>()
  for (const row of sorted) {
    const key = row.normalizedValue.trim() || row.value.trim().toLowerCase()
    if (key && !selected.has(key)) selected.set(key, row)
  }
  return selected
}

function isUnchangedShippedDictionaryRow(row: CustomerDictionaryEntry, key: string): boolean {
  const shipped = calendarEventTypes.find((entry) => entry.key === key)
  return !!shipped && !row.activityTypeBehavior && row.label === shipped.label &&
    row.icon === shipped.icon && row.color === shipped.color
}

export async function resolveScopedCalendarEventTypes(
  input: ResolveCalendarEventTypesInput,
): Promise<CalendarEventTypeCatalog> {
  await ensureCalendarEventTypeWidgetsLoaded()
  const scopeOrganizationIds = Array.from(new Set([input.organizationId, ...input.readableOrganizationIds]))
  const rows = await findWithDecryption(
    input.em,
    CustomerDictionaryEntry,
    {
      tenantId: input.tenantId,
      organizationId: { $in: scopeOrganizationIds },
      kind: 'activity_type',
    },
    { orderBy: { label: 'asc' } },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  const dictionaryRows = selectDictionaryRows(rows, input.organizationId, scopeOrganizationIds)
  for (const [key, row] of dictionaryRows) {
    if (isUnchangedShippedDictionaryRow(row, key)) dictionaryRows.delete(key)
  }
  const staticCatalog = resolveBaselineCalendarEventTypes()
  const availableFieldsets = input.availableCustomFieldsetIdsFromEntitiesBoundary
    ? new Set(input.availableCustomFieldsetIdsFromEntitiesBoundary)
    : null
  const staticByKey = new Map(staticCatalog.items.map((item) => [item.key, item]))
  const tombstonedKeys = new Set(getCalendarEventTypeTombstones().map((entry) => entry.key))
  const keys = new Set([...staticByKey.keys(), ...[...dictionaryRows.keys()].filter((key) => !tombstonedKeys.has(key))])
  const fallbackBehavior = calendarEventTypes[0]!.behavior
  const items = [...keys].map((key): ScopedCalendarEventType => {
    const base = staticByKey.get(key)
    const row = dictionaryRows.get(key)
    if (!row) {
      if (!availableFieldsets) return base!
      return deepFreeze({
        ...base!,
        missingCustomFieldsetIds: base!.behavior.customFieldsetIds.filter((id) => !availableFieldsets.has(id)),
      })
    }
    if (base?.adminConfigurable === false) {
      return deepFreeze({
        ...base,
        inactiveDictionaryOverride: true,
      })
    }
    const parsedBehavior = row.activityTypeBehavior
      ? calendarEventTypeBehaviorSchema.safeParse(row.activityTypeBehavior)
      : null
    const behavior = parsedBehavior?.success
      ? parsedBehavior.data
      : base?.behavior ?? { ...fallbackBehavior, selectable: true }
    const isLocalOverride = row.organizationId === input.organizationId
    const defaultLabel = calendarEventTypes.find((entry) => entry.key === key)?.label ?? base?.label
    const hasCustomLabel = !!row.label && row.label !== defaultLabel
    return deepFreeze({
      key,
      label: hasCustomLabel ? row.label : base?.label || row.label || row.value,
      ...(!hasCustomLabel && base?.labelKey ? { labelKey: base.labelKey } : {}),
      icon: row.icon ?? base?.icon ?? null,
      color: row.color ?? base?.color ?? null,
      behavior,
      selectable: behavior.selectable,
      ...(base?.panelKey ? { panelKey: base.panelKey } : {}),
      source: base?.source ?? 'dictionary',
      provenance: base?.provenance ?? {},
      historical: false,
      adminConfigurable: true,
      isInherited: !isLocalOverride,
      isLocalOverride,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
      missingCustomFieldsetIds: availableFieldsets
        ? behavior.customFieldsetIds.filter((id) => !availableFieldsets.has(id))
        : [],
    })
  })
  items.sort((left, right) => left.behavior.order - right.behavior.order || left.key.localeCompare(right.key))
  return deepFreeze({ items, fallbackKey: 'meeting' })
}

export function resolveCatalogEventType(
  catalog: CalendarEventTypeCatalog,
  key: string,
  options: { includeHistorical?: boolean } = {},
): ScopedCalendarEventType | undefined {
  const normalizedKey = key.trim().toLowerCase()
  const item = catalog.items.find((entry) => entry.key === normalizedKey)
  if (item || !options.includeHistorical) return item
  const registryHistorical = resolveCalendarEventType(key, { includeHistorical: true })
  if (registryHistorical) {
    const serialized = serializeStaticType(registryHistorical)
    return deepFreeze({
      ...serialized,
      selectable: false,
      behavior: { ...serialized.behavior, selectable: false },
      historical: true,
    })
  }
  const fallback = catalog.items.find((entry) => entry.key === catalog.fallbackKey)
  if (!fallback) return undefined
  return deepFreeze({
    ...fallback,
    key,
    label: key,
    labelKey: undefined,
    behavior: { ...fallback.behavior, selectable: false },
    selectable: false,
    historical: true,
    source: 'historical-fallback',
    isInherited: false,
    isLocalOverride: false,
    updatedAt: null,
  })
}
