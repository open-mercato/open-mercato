import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { StaffTimeTrackingSettingsInput } from '../../data/validators'
import {
  type RoundingDirection,
  type RoundingSettings,
  type RoundingUnitMinutes,
} from './rounding'
import {
  DEFAULT_ASSIGNMENT_GRACE_DAYS,
  MAX_ASSIGNMENT_GRACE_DAYS,
  buildDefaultTimeTrackingSettings,
  listTimeTrackingSettingKeys,
  normalizeTimeTrackingSettingsRecord,
  registerTimeTrackingSettingKey,
  timeTrackingSettingKeyIds,
  type TimeTrackingSettingKeyDefinition,
  type TimeTrackingSettingKeyInput,
  type TimeTrackingSettingsRecord,
} from './settingKeys'

export type { RoundingDirection, RoundingSettings, RoundingUnitMinutes }
export type { TimeTrackingSettingKeyDefinition, TimeTrackingSettingKeyInput, TimeTrackingSettingsRecord }
export { DEFAULT_ASSIGNMENT_GRACE_DAYS, MAX_ASSIGNMENT_GRACE_DAYS, registerTimeTrackingSettingKey }

export const STAFF_TIME_TRACKING_MODULE_ID = 'staff.time_tracking'

export const TIME_TRACKING_ROUNDING_UNIT_MINUTES_KEY = 'rounding.unitMinutes'
export const TIME_TRACKING_ROUNDING_DIRECTION_KEY = 'rounding.direction'
export const TIME_TRACKING_DEFAULTS_BILLABLE_KEY = 'defaults.billable'
export const TIME_TRACKING_DEFAULTS_CHAIN_START_KEY = 'defaults.chainStartFromPreviousEnd'
export const TIME_TRACKING_TARGETS_DAILY_HOURS_KEY = 'targets.dailyHours'
export const TIME_TRACKING_WARNINGS_OVERLAP_KEY = 'warnings.overlap'
export const TIME_TRACKING_WARNINGS_RUNNING_TIMER_KEY = 'warnings.runningTimer'
export const TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY = 'access.assignmentGraceDays'

/**
 * The eight keys the module shipped. FROZEN — a stored config row is named after one
 * of these, so none may be renamed or removed. The list is no longer the whole truth:
 * `timeTrackingSettingKeyIds()` returns these plus every contributed key (EP-42).
 */
export const TIME_TRACKING_SETTING_KEYS = [
  TIME_TRACKING_ROUNDING_UNIT_MINUTES_KEY,
  TIME_TRACKING_ROUNDING_DIRECTION_KEY,
  TIME_TRACKING_DEFAULTS_BILLABLE_KEY,
  TIME_TRACKING_DEFAULTS_CHAIN_START_KEY,
  TIME_TRACKING_TARGETS_DAILY_HOURS_KEY,
  TIME_TRACKING_WARNINGS_OVERLAP_KEY,
  TIME_TRACKING_WARNINGS_RUNNING_TIMER_KEY,
  TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY,
] as const

export type TimeTrackingSettingKey = (typeof TIME_TRACKING_SETTING_KEYS)[number]

export type TimeTrackingEntryDefaults = {
  billable: boolean
  chainStartFromPreviousEnd: boolean
}

export type TimeTrackingTargets = {
  dailyHours: number | null
}

export type TimeTrackingWarnings = {
  overlap: boolean
  runningTimer: boolean
}

export type TimeTrackingAccess = {
  assignmentGraceDays: number
}

export type TimeTrackingBuiltInSettings = {
  rounding: RoundingSettings
  defaults: TimeTrackingEntryDefaults
  targets: TimeTrackingTargets
  warnings: TimeTrackingWarnings
  access: TimeTrackingAccess
}

/**
 * The five built-in groups stay statically typed; a contributed group or key reaches
 * a caller through the index signature and is read with `readTimeTrackingSettingValue`.
 */
export type TimeTrackingSettings = TimeTrackingBuiltInSettings & TimeTrackingSettingsRecord

/**
 * Settings are global per tenant (spec §10 fixes them there — no per-project or
 * per-customer override), so the scope carries the tenant only and MUST be
 * derived from the authenticated context, never from request input. A contributed
 * key inherits exactly that scope.
 */
export type TimeTrackingSettingsScope = {
  tenantId: string
}

export const DEFAULT_TIME_TRACKING_SETTINGS: TimeTrackingSettings =
  buildDefaultTimeTrackingSettings() as TimeTrackingSettings

/**
 * Coerce an arbitrary (possibly partial or malformed) settings shape into the
 * canonical one, filling every absent or invalid value from the registered defaults.
 */
export function normalizeTimeTrackingSettings(
  input: Partial<TimeTrackingBuiltInSettings> | TimeTrackingSettingsRecord | StaffTimeTrackingSettingsInput | null | undefined,
): TimeTrackingSettings {
  return normalizeTimeTrackingSettingsRecord(input) as TimeTrackingSettings
}

/** Reads one registered key out of a normalized settings object by its `<group>.<key>` id. */
export function readTimeTrackingSettingValue(
  settings: TimeTrackingSettings,
  id: string,
): unknown {
  const separator = id.indexOf('.')
  if (separator <= 0) return undefined
  const group = settings[id.slice(0, separator)]
  if (!group || typeof group !== 'object') return undefined
  return (group as Record<string, unknown>)[id.slice(separator + 1)]
}

export { listTimeTrackingSettingKeys, timeTrackingSettingKeyIds }

/**
 * Resolve the tenant's time tracking settings. Absent keys (and keys holding a
 * value the schema no longer accepts) fall back to the registered default, so a
 * tenant that never opened the settings screen still reads a complete record.
 */
export async function readTimeTrackingSettings(
  configService: ModuleConfigService,
  scope: TimeTrackingSettingsScope,
): Promise<TimeTrackingSettings> {
  const configScope = { tenantId: scope.tenantId }
  // `getRecord` rather than `getValue` so an explicitly stored `null`
  // (`targets.dailyHours` = "no daily target") stays distinguishable from an
  // absent row, which must fall back to the default.
  const stored: TimeTrackingSettingsRecord = {}
  for (const entry of listTimeTrackingSettingKeys()) {
    const record = await configService.getRecord(STAFF_TIME_TRACKING_MODULE_ID, entry.id, configScope)
    if (!record) continue
    const group = stored[entry.group] ?? {}
    group[entry.key] = record.value
    stored[entry.group] = group
  }
  return normalizeTimeTrackingSettings(stored)
}

/**
 * Persist the tenant's time tracking settings and return the stored shape.
 */
export async function writeTimeTrackingSettings(
  configService: ModuleConfigService,
  scope: TimeTrackingSettingsScope,
  input: Partial<TimeTrackingBuiltInSettings> | TimeTrackingSettingsRecord | StaffTimeTrackingSettingsInput,
): Promise<TimeTrackingSettings> {
  const settings = normalizeTimeTrackingSettings(input)
  const configScope = { tenantId: scope.tenantId }

  for (const entry of listTimeTrackingSettingKeys()) {
    await configService.setValue(
      STAFF_TIME_TRACKING_MODULE_ID,
      entry.id,
      readTimeTrackingSettingValue(settings, entry.id),
      configScope,
    )
  }

  return settings
}
