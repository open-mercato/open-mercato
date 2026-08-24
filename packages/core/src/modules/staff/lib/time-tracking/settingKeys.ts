/**
 * EP-42 — the time-tracking settings key registry.
 *
 * `TIME_TRACKING_SETTING_KEYS` used to be a frozen array, `normalizeTimeTrackingSettings`
 * a hand-written coercion per key, and `staffTimeTrackingSettingsSchema` a literal
 * `z.object`. All three now read this registry, and the eight keys the module shipped
 * are registered here as built-ins — so with no contribution the read, the write, the
 * validating schema and the defaults are byte-identical to what they were.
 *
 * Storage is `ModuleConfigService` under module id `staff.time_tracking`, one config
 * row per key, named `<group>.<key>` and scoped by **tenant only** (spec §10: time
 * tracking settings are tenant-global; there is no per-organization override and no
 * per-project override). A contributed key inherits exactly that scope — it is written
 * with `{ tenantId }` and `organization_id` stays null.
 */

import { z } from 'zod'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { BUILT_IN_STRATEGY_PRIORITY, createStrategyRegistry } from './registries/registry'
import { DEFAULT_ROUNDING_SETTINGS } from './rounding'

export const TIME_TRACKING_SETTING_KEY_REGISTRY_ID = extensionPoints.hosts.settingKeyRegistry.spotId

export const TIME_TRACKING_ROUNDING_GROUP = 'rounding'
export const TIME_TRACKING_DEFAULTS_GROUP = 'defaults'
export const TIME_TRACKING_TARGETS_GROUP = 'targets'
export const TIME_TRACKING_WARNINGS_GROUP = 'warnings'
export const TIME_TRACKING_ACCESS_GROUP = 'access'

/**
 * Days past `assigned_end_date` that project access survives (spec D-12). The
 * grace window exists so a consultant rolled off at the end of a month can still
 * log and correct that month's time; `0` ends access the day the assignment ends.
 */
export const DEFAULT_ASSIGNMENT_GRACE_DAYS = 14

export const MAX_ASSIGNMENT_GRACE_DAYS = 365

export const timeTrackingRoundingUnitMinutesSchema = z.union([
  z.literal(0),
  z.literal(5),
  z.literal(10),
  z.literal(15),
])

export const timeTrackingRoundingDirectionSchema = z.enum(['up', 'nearest'])

export type TimeTrackingSettingKeyInput = {
  /** Group the value lives under in the settings object, e.g. `rounding`. */
  group: string
  /** Leaf name inside the group, e.g. `unitMinutes`. */
  key: string
  /** Validates the stored value; an invalid one falls back to `default`. */
  schema: z.ZodTypeAny
  /** Used when the tenant never stored the key and when the stored value no longer validates. */
  default: unknown
  /** i18n key for the label a settings section renders. Never a literal — the module holds no user-facing strings. */
  labelKey: string
  /** Higher first in `listTimeTrackingSettingKeys()`; built-ins sit below every contribution. */
  priority?: number
}

export type TimeTrackingSettingKeyDefinition = TimeTrackingSettingKeyInput & {
  /** `<group>.<key>` — the `ModuleConfigService` config name. */
  id: string
  builtIn: boolean
}

const registry = createStrategyRegistry<TimeTrackingSettingKeyDefinition>(
  TIME_TRACKING_SETTING_KEY_REGISTRY_ID,
)

const builtInIds = new Set<string>()

export function timeTrackingSettingStorageName(group: string, key: string): string {
  return `${group}.${key}`
}

function registerKey(input: TimeTrackingSettingKeyInput, builtIn: boolean): () => void {
  const group = input.group.trim()
  const key = input.key.trim()
  if (!group || !key) {
    throw new Error('[internal] a time-tracking setting key requires a non-empty group and key')
  }
  const id = timeTrackingSettingStorageName(group, key)
  if (!builtIn && builtInIds.has(id)) {
    throw new Error(`[internal] ${id} is a built-in time-tracking setting key and cannot be replaced`)
  }
  const parsed = input.schema.safeParse(input.default)
  if (!parsed.success) {
    throw new Error(`[internal] the default for the time-tracking setting key ${id} fails its own schema`)
  }
  return registry.register({ ...input, group, key, id, builtIn })
}

/**
 * Contribute a tenant-scoped time-tracking setting key. Pair it with a widget on the
 * `staff.time_tracking.settings:sections` injection spot (EP-26) to render it: the spot
 * context carries `values` for every contributed key and a `setValue(id, value)` that
 * writes into the page draft, so the page's own Save round-trips the contribution.
 */
export function registerTimeTrackingSettingKey(input: TimeTrackingSettingKeyInput): () => void {
  return registerKey(input, false)
}

export function listTimeTrackingSettingKeys(): TimeTrackingSettingKeyDefinition[] {
  return registry.list()
}

export function getTimeTrackingSettingKey(id: string | null | undefined): TimeTrackingSettingKeyDefinition | null {
  return registry.get(id)
}

export function timeTrackingSettingKeyIds(): string[] {
  return registry.ids()
}

/** The contributed keys only — the eight built-ins are rendered by the settings page's own form. */
export function contributedTimeTrackingSettingKeys(): TimeTrackingSettingKeyDefinition[] {
  return registry.list().filter((entry) => !entry.builtIn)
}

export function timeTrackingSettingGroups(): string[] {
  const groups: string[] = []
  for (const entry of registry.list()) {
    if (!groups.includes(entry.group)) groups.push(entry.group)
  }
  return groups
}

const BUILT_IN_SETTING_KEYS: readonly TimeTrackingSettingKeyInput[] = [
  {
    group: TIME_TRACKING_ROUNDING_GROUP,
    key: 'unitMinutes',
    schema: timeTrackingRoundingUnitMinutesSchema,
    default: DEFAULT_ROUNDING_SETTINGS.unitMinutes,
    labelKey: 'staff.time_tracking.settings.rounding.unit',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_ROUNDING_GROUP,
    key: 'direction',
    schema: timeTrackingRoundingDirectionSchema,
    default: DEFAULT_ROUNDING_SETTINGS.direction,
    labelKey: 'staff.time_tracking.settings.rounding.direction',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_DEFAULTS_GROUP,
    key: 'billable',
    schema: z.boolean(),
    default: true,
    labelKey: 'staff.time_tracking.settings.defaults.billable',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_DEFAULTS_GROUP,
    key: 'chainStartFromPreviousEnd',
    schema: z.boolean(),
    default: true,
    labelKey: 'staff.time_tracking.settings.defaults.chainStart',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_TARGETS_GROUP,
    key: 'dailyHours',
    schema: z.number().min(0).max(24).nullable(),
    default: 8,
    labelKey: 'staff.time_tracking.settings.targets.dailyHours',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_WARNINGS_GROUP,
    key: 'overlap',
    schema: z.boolean(),
    default: true,
    labelKey: 'staff.time_tracking.settings.warnings.overlap',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_WARNINGS_GROUP,
    key: 'runningTimer',
    schema: z.boolean(),
    default: true,
    labelKey: 'staff.time_tracking.settings.warnings.runningTimer',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
  {
    group: TIME_TRACKING_ACCESS_GROUP,
    key: 'assignmentGraceDays',
    schema: z.number().int().min(0).max(MAX_ASSIGNMENT_GRACE_DAYS),
    default: DEFAULT_ASSIGNMENT_GRACE_DAYS,
    labelKey: 'staff.time_tracking.settings.access.graceDays',
    priority: BUILT_IN_STRATEGY_PRIORITY,
  },
]

for (const input of BUILT_IN_SETTING_KEYS) {
  registerKey(input, true)
  builtInIds.add(timeTrackingSettingStorageName(input.group, input.key))
}

export const BUILT_IN_TIME_TRACKING_SETTING_KEY_IDS: readonly string[] = Object.freeze(
  BUILT_IN_SETTING_KEYS.map((input) => timeTrackingSettingStorageName(input.group, input.key)),
)

export function isBuiltInTimeTrackingSettingKey(id: string): boolean {
  return builtInIds.has(id)
}

export type TimeTrackingSettingsRecord = Record<string, Record<string, unknown>>

/**
 * The validating schema the settings route parses against, rebuilt per call so a key
 * registered after this module first loaded still validates (the same reason EP-35's
 * export-format enum is an OpenAPI getter).
 */
export function buildTimeTrackingSettingsSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const byGroup = new Map<string, Record<string, z.ZodTypeAny>>()
  const defaultsByGroup = new Map<string, Record<string, unknown>>()
  for (const entry of registry.list()) {
    const shape = byGroup.get(entry.group) ?? {}
    shape[entry.key] = entry.schema.optional().default(entry.default)
    byGroup.set(entry.group, shape)
    const defaults = defaultsByGroup.get(entry.group) ?? {}
    defaults[entry.key] = entry.default
    defaultsByGroup.set(entry.group, defaults)
  }
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [group, groupShape] of byGroup) {
    shape[group] = z.object(groupShape).optional().default(defaultsByGroup.get(group) ?? {})
  }
  return z.object(shape)
}

/** The canonical settings object with every registered key at its registered default. */
export function buildDefaultTimeTrackingSettings(): TimeTrackingSettingsRecord {
  const result: TimeTrackingSettingsRecord = {}
  for (const entry of registry.list()) {
    const group = result[entry.group] ?? {}
    group[entry.key] = entry.default
    result[entry.group] = group
  }
  return result
}

function readGroup(source: unknown, group: string): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[group]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Coerce an arbitrary (possibly partial or malformed) settings shape into the canonical
 * one: every registered key present, every absent or invalid value replaced by the
 * registered default.
 */
export function normalizeTimeTrackingSettingsRecord(input: unknown): TimeTrackingSettingsRecord {
  const result: TimeTrackingSettingsRecord = {}
  for (const entry of registry.list()) {
    const group = result[entry.group] ?? {}
    const raw = readGroup(input, entry.group)?.[entry.key]
    const parsed = entry.schema.safeParse(raw)
    group[entry.key] = parsed.success ? parsed.data : entry.default
    result[entry.group] = group
  }
  return result
}
