// Compile-time-only guard for the exported time-tracking settings shapes. Never imported
// at runtime: `yarn typecheck` (`tsc --noEmit`) is the only gate that catches a
// regression here, because the Jest transform skips type diagnostics and
// `packages/core/tsconfig.json` excludes `__tests__`. Same convention as
// `packages/shared/src/lib/i18n/config.typecheck.tsx`.
//
// What it protects: `defaults.entryMode` (#6989) was added after these types were
// published. Downstream code builds `TimeTrackingEntryDefaults` / `TimeTrackingSettings`
// literals (settings-key contributions, typed fixtures), so the pre-#6989 shape without
// `entryMode` must keep compiling (BACKWARD_COMPATIBILITY.md, exported types).
import type {
  TimeEntryMode,
  TimeTrackingEntryDefaults,
  TimeTrackingSettings,
} from './settings'
import type { TimeTrackingSettingsDraft } from '../time-tracking-ui/timeTrackingSettingsForm'

const legacyEntryDefaults: TimeTrackingEntryDefaults = {
  billable: true,
  chainStartFromPreviousEnd: false,
}

const legacySettings: TimeTrackingSettings = {
  rounding: { unitMinutes: 15, direction: 'up' },
  defaults: { billable: true, chainStartFromPreviousEnd: true },
  targets: { dailyHours: 8 },
  warnings: { overlap: true, runningTimer: true },
  access: { assignmentGraceDays: 14 },
}

const legacyDraft: TimeTrackingSettingsDraft = {
  roundingUnitMinutes: 15,
  roundingDirection: 'up',
  defaultsBillable: true,
  defaultsChainStartFromPreviousEnd: true,
  dailyHoursText: '8',
  warningsOverlap: true,
  warningsRunningTimer: true,
  assignmentGraceDaysText: '14',
  contributed: {},
}

const currentEntryDefaults: TimeTrackingEntryDefaults = {
  billable: true,
  chainStartFromPreviousEnd: true,
  entryMode: 'project',
}

const readEntryMode: TimeEntryMode = legacySettings.defaults.entryMode ?? 'task'

const invalidEntryMode: TimeTrackingEntryDefaults = {
  billable: true,
  chainStartFromPreviousEnd: true,
  // @ts-expect-error only 'task' | 'project' are entry modes
  entryMode: 'tasks',
}

void legacyEntryDefaults
void legacySettings
void legacyDraft
void currentEntryDefaults
void readEntryMode
void invalidEntryMode
