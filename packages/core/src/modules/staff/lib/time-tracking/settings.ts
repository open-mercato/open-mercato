import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { StaffTimeTrackingSettingsInput } from '../../data/validators'
import {
  DEFAULT_ROUNDING_SETTINGS,
  type RoundingDirection,
  type RoundingSettings,
  type RoundingUnitMinutes,
} from './rounding'

export type { RoundingDirection, RoundingSettings, RoundingUnitMinutes }

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
 * Days past `assigned_end_date` that project access survives (spec D-12). The
 * grace window exists so a consultant rolled off at the end of a month can still
 * log and correct that month's time; `0` ends access the day the assignment ends.
 */
export const DEFAULT_ASSIGNMENT_GRACE_DAYS = 14

export const MAX_ASSIGNMENT_GRACE_DAYS = 365

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

export type TimeTrackingSettings = {
  rounding: RoundingSettings
  defaults: TimeTrackingEntryDefaults
  targets: TimeTrackingTargets
  warnings: TimeTrackingWarnings
  access: TimeTrackingAccess
}

/**
 * Settings are global per tenant (spec §10 fixes them there — no per-project or
 * per-customer override), so the scope carries the tenant only and MUST be
 * derived from the authenticated context, never from request input.
 */
export type TimeTrackingSettingsScope = {
  tenantId: string
}

export const DEFAULT_TIME_TRACKING_SETTINGS: TimeTrackingSettings = {
  rounding: { ...DEFAULT_ROUNDING_SETTINGS },
  defaults: { billable: true, chainStartFromPreviousEnd: true },
  targets: { dailyHours: 8 },
  warnings: { overlap: true, runningTimer: true },
  access: { assignmentGraceDays: DEFAULT_ASSIGNMENT_GRACE_DAYS },
}

const ROUNDING_UNIT_VALUES: readonly number[] = [0, 5, 10, 15]
const ROUNDING_DIRECTION_VALUES: readonly string[] = ['up', 'nearest']

function toRoundingUnitMinutes(value: unknown, fallback: RoundingUnitMinutes): RoundingUnitMinutes {
  return typeof value === 'number' && ROUNDING_UNIT_VALUES.includes(value)
    ? (value as RoundingUnitMinutes)
    : fallback
}

function toRoundingDirection(value: unknown, fallback: RoundingDirection): RoundingDirection {
  return typeof value === 'string' && ROUNDING_DIRECTION_VALUES.includes(value)
    ? (value as RoundingDirection)
    : fallback
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toDailyHours(value: unknown, fallback: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < 0 || value > 24) return fallback
  return value
}

function toAssignmentGraceDays(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  if (value < 0 || value > MAX_ASSIGNMENT_GRACE_DAYS) return fallback
  return value
}

type PartialTimeTrackingSettings = {
  rounding?: Partial<RoundingSettings> | null
  defaults?: Partial<TimeTrackingEntryDefaults> | null
  targets?: Partial<TimeTrackingTargets> | null
  warnings?: Partial<TimeTrackingWarnings> | null
  access?: Partial<TimeTrackingAccess> | null
}

/**
 * Coerce an arbitrary (possibly partial or malformed) settings shape into the
 * canonical one, filling every absent or invalid value from the defaults.
 */
export function normalizeTimeTrackingSettings(
  input: PartialTimeTrackingSettings | StaffTimeTrackingSettingsInput | null | undefined,
): TimeTrackingSettings {
  const source = (input ?? {}) as PartialTimeTrackingSettings
  return {
    rounding: {
      unitMinutes: toRoundingUnitMinutes(
        source.rounding?.unitMinutes,
        DEFAULT_TIME_TRACKING_SETTINGS.rounding.unitMinutes,
      ),
      direction: toRoundingDirection(
        source.rounding?.direction,
        DEFAULT_TIME_TRACKING_SETTINGS.rounding.direction,
      ),
    },
    defaults: {
      billable: toBoolean(source.defaults?.billable, DEFAULT_TIME_TRACKING_SETTINGS.defaults.billable),
      chainStartFromPreviousEnd: toBoolean(
        source.defaults?.chainStartFromPreviousEnd,
        DEFAULT_TIME_TRACKING_SETTINGS.defaults.chainStartFromPreviousEnd,
      ),
    },
    targets: {
      dailyHours: toDailyHours(source.targets?.dailyHours, DEFAULT_TIME_TRACKING_SETTINGS.targets.dailyHours),
    },
    warnings: {
      overlap: toBoolean(source.warnings?.overlap, DEFAULT_TIME_TRACKING_SETTINGS.warnings.overlap),
      runningTimer: toBoolean(
        source.warnings?.runningTimer,
        DEFAULT_TIME_TRACKING_SETTINGS.warnings.runningTimer,
      ),
    },
    access: {
      assignmentGraceDays: toAssignmentGraceDays(
        source.access?.assignmentGraceDays,
        DEFAULT_TIME_TRACKING_SETTINGS.access.assignmentGraceDays,
      ),
    },
  }
}

/**
 * Resolve the tenant's time tracking settings. Absent keys (and keys holding a
 * value the schema no longer accepts) fall back to `DEFAULT_TIME_TRACKING_SETTINGS`,
 * so a tenant that never opened the settings screen still reads a complete record.
 */
export async function readTimeTrackingSettings(
  configService: ModuleConfigService,
  scope: TimeTrackingSettingsScope,
): Promise<TimeTrackingSettings> {
  const configScope = { tenantId: scope.tenantId }
  // `getRecord` rather than `getValue` so an explicitly stored `null`
  // (`targets.dailyHours` = "no daily target") stays distinguishable from an
  // absent row, which must fall back to the default.
  const readValue = async (name: TimeTrackingSettingKey): Promise<unknown> => {
    const record = await configService.getRecord(STAFF_TIME_TRACKING_MODULE_ID, name, configScope)
    return record ? record.value : undefined
  }

  const unitMinutes = await readValue(TIME_TRACKING_ROUNDING_UNIT_MINUTES_KEY)
  const direction = await readValue(TIME_TRACKING_ROUNDING_DIRECTION_KEY)
  const billable = await readValue(TIME_TRACKING_DEFAULTS_BILLABLE_KEY)
  const chainStartFromPreviousEnd = await readValue(TIME_TRACKING_DEFAULTS_CHAIN_START_KEY)
  const dailyHours = await readValue(TIME_TRACKING_TARGETS_DAILY_HOURS_KEY)
  const overlap = await readValue(TIME_TRACKING_WARNINGS_OVERLAP_KEY)
  const runningTimer = await readValue(TIME_TRACKING_WARNINGS_RUNNING_TIMER_KEY)
  const assignmentGraceDays = await readValue(TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY)

  return normalizeTimeTrackingSettings({
    rounding: {
      unitMinutes: unitMinutes as RoundingUnitMinutes,
      direction: direction as RoundingDirection,
    },
    defaults: {
      billable: billable as boolean,
      chainStartFromPreviousEnd: chainStartFromPreviousEnd as boolean,
    },
    targets: { dailyHours: dailyHours as number | null },
    warnings: { overlap: overlap as boolean, runningTimer: runningTimer as boolean },
    access: { assignmentGraceDays: assignmentGraceDays as number },
  })
}

/**
 * Persist the tenant's time tracking settings and return the stored shape.
 */
export async function writeTimeTrackingSettings(
  configService: ModuleConfigService,
  scope: TimeTrackingSettingsScope,
  input: PartialTimeTrackingSettings | StaffTimeTrackingSettingsInput,
): Promise<TimeTrackingSettings> {
  const settings = normalizeTimeTrackingSettings(input)
  const configScope = { tenantId: scope.tenantId }
  const values: Array<[TimeTrackingSettingKey, unknown]> = [
    [TIME_TRACKING_ROUNDING_UNIT_MINUTES_KEY, settings.rounding.unitMinutes],
    [TIME_TRACKING_ROUNDING_DIRECTION_KEY, settings.rounding.direction],
    [TIME_TRACKING_DEFAULTS_BILLABLE_KEY, settings.defaults.billable],
    [TIME_TRACKING_DEFAULTS_CHAIN_START_KEY, settings.defaults.chainStartFromPreviousEnd],
    [TIME_TRACKING_TARGETS_DAILY_HOURS_KEY, settings.targets.dailyHours],
    [TIME_TRACKING_WARNINGS_OVERLAP_KEY, settings.warnings.overlap],
    [TIME_TRACKING_WARNINGS_RUNNING_TIMER_KEY, settings.warnings.runningTimer],
    [TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY, settings.access.assignmentGraceDays],
  ]

  for (const [name, value] of values) {
    await configService.setValue(STAFF_TIME_TRACKING_MODULE_ID, name, value, configScope)
  }

  return settings
}
