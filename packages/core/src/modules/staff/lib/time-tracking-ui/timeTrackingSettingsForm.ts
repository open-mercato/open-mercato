/**
 * Pure state for the module settings screen (T7.1, screen 16).
 *
 * The screen edits two numbers that are legitimately empty-able or bounded
 * (`targets.dailyHours` may be blank = no target; `access.assignmentGraceDays` is
 * an integer day count), so the draft keeps them as the TEXT the user typed and
 * converts only at the edges. Stripping a half-typed number back into the field is
 * the same defect `DurationInput` was built to avoid.
 *
 * `buildRoundingExamples` is the screen's most load-bearing function: note 1 of the
 * mockup requires the worked examples to recompute live, because rounding is a rule
 * people misread and its effect is otherwise invisible until an invoice. It calls
 * `roundMinutes` — the same function the write path calls — so a preview that
 * disagreed with reality is not expressible here.
 */

import { formatDuration } from '../time-tracking/duration'
import { roundMinutes, type RoundingSettings, type RoundingUnitMinutes } from '../time-tracking/rounding'
import { DEFAULT_SUPPORT_REFERENCE_PREFIX, contributedTimeTrackingSettingKeys } from '../time-tracking/settingKeys'
import { readTimeTrackingSettingValue, type TimeTrackingSettings } from '../time-tracking/settings'

export const ROUNDING_UNIT_OPTIONS: readonly RoundingUnitMinutes[] = [0, 5, 10, 15]

/**
 * The four cases from the mockup: just over a unit, past the halfway point, a
 * minimum-charge case, and one that is already exact and must not move.
 */
export const ROUNDING_EXAMPLE_MINUTES: readonly number[] = [62, 76, 3, 120]

export type RoundingExample = {
  rawMinutes: number
  roundedMinutes: number
  rawLabel: string
  roundedLabel: string
}

export function buildRoundingExamples(rounding: RoundingSettings): RoundingExample[] {
  return ROUNDING_EXAMPLE_MINUTES.map((rawMinutes) => {
    const roundedMinutes = roundMinutes(rawMinutes, rounding)
    return {
      rawMinutes,
      roundedMinutes,
      rawLabel: formatDuration(rawMinutes, 'clock'),
      roundedLabel: formatDuration(roundedMinutes, 'clock'),
    }
  })
}

/** `+38:15` / `−12:30` / `0:00`, for the impact card's delta against raw time. */
export function formatSignedMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.round(minutes) : 0
  const magnitude = formatDuration(Math.abs(safe), 'clock')
  if (safe > 0) return `+${magnitude}`
  if (safe < 0) return `−${magnitude}`
  return magnitude
}

export type TimeTrackingSettingsDraft = {
  roundingUnitMinutes: RoundingUnitMinutes
  roundingDirection: RoundingSettings['direction']
  defaultsBillable: boolean
  defaultsChainStartFromPreviousEnd: boolean
  /** Free text: empty means "no daily target", which is a real, storable value. */
  dailyHoursText: string
  warningsOverlap: boolean
  warningsRunningTimer: boolean
  assignmentGraceDaysText: string
  /** Edited on the Support settings tab; carried through so this page's Save never resets it. */
  supportReferencePrefix: string
  /**
   * EP-42 — every contributed setting key, by its `<group>.<key>` id, carried through
   * the draft untouched so the page's own Save round-trips a contribution it knows
   * nothing about. The eight built-ins are NOT in here: the page renders those itself.
   */
  contributed: Record<string, unknown>
}


export const MAX_ASSIGNMENT_GRACE_DAYS_INPUT = 365

export function toSettingsDraft(settings: TimeTrackingSettings): TimeTrackingSettingsDraft {
  return {
    roundingUnitMinutes: settings.rounding.unitMinutes,
    roundingDirection: settings.rounding.direction,
    defaultsBillable: settings.defaults.billable,
    defaultsChainStartFromPreviousEnd: settings.defaults.chainStartFromPreviousEnd,
    dailyHoursText: settings.targets.dailyHours === null ? '' : String(settings.targets.dailyHours),
    warningsOverlap: settings.warnings.overlap,
    warningsRunningTimer: settings.warnings.runningTimer,
    assignmentGraceDaysText: String(settings.access.assignmentGraceDays),
    supportReferencePrefix: settings.support?.referencePrefix ?? DEFAULT_SUPPORT_REFERENCE_PREFIX,
    contributed: Object.fromEntries(
      contributedTimeTrackingSettingKeys().map((entry) => [
        entry.id,
        readTimeTrackingSettingValue(settings, entry.id),
      ]),
    ),
  }
}

export type SettingsDraftFieldError = 'dailyHours' | 'assignmentGraceDays'

function parseDailyHours(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) return undefined
  return parsed
}

function parseGraceDays(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_ASSIGNMENT_GRACE_DAYS_INPUT) return undefined
  return parsed
}

/** Which fields currently hold text that cannot be saved. Empty means the draft is valid. */
export function settingsDraftErrors(draft: TimeTrackingSettingsDraft): SettingsDraftFieldError[] {
  const errors: SettingsDraftFieldError[] = []
  if (parseDailyHours(draft.dailyHoursText) === undefined) errors.push('dailyHours')
  if (parseGraceDays(draft.assignmentGraceDaysText) === undefined) errors.push('assignmentGraceDays')
  return errors
}

export function draftRounding(draft: TimeTrackingSettingsDraft): RoundingSettings {
  return { unitMinutes: draft.roundingUnitMinutes, direction: draft.roundingDirection }
}

/** The PUT body. Returns null when the draft still holds unsaveable text. */
export function toSettingsPayload(draft: TimeTrackingSettingsDraft): TimeTrackingSettings | null {
  const dailyHours = parseDailyHours(draft.dailyHoursText)
  const assignmentGraceDays = parseGraceDays(draft.assignmentGraceDaysText)
  if (dailyHours === undefined || assignmentGraceDays === undefined) return null
  const payload: TimeTrackingSettings = {
    rounding: draftRounding(draft),
    defaults: {
      billable: draft.defaultsBillable,
      chainStartFromPreviousEnd: draft.defaultsChainStartFromPreviousEnd,
    },
    targets: { dailyHours },
    warnings: { overlap: draft.warningsOverlap, runningTimer: draft.warningsRunningTimer },
    access: { assignmentGraceDays },
    support: { referencePrefix: draft.supportReferencePrefix },
  }
  for (const entry of contributedTimeTrackingSettingKeys()) {
    const group = (payload[entry.group] ?? {}) as Record<string, unknown>
    group[entry.key] = draft.contributed[entry.id]
    payload[entry.group] = group
  }
  return payload
}

/**
 * A settings tab that saves the record itself moves the stored baseline under the
 * page's draft. Rebase the draft onto the new record: a field the user has not touched
 * takes the saved value, an edited field keeps the edit, so the page's Save neither
 * reverts the tab's write nor drops pending changes.
 */
export function rebaseSettingsDraft(
  draft: TimeTrackingSettingsDraft,
  previousBaseline: TimeTrackingSettingsDraft,
  nextBaseline: TimeTrackingSettingsDraft,
): TimeTrackingSettingsDraft {
  const pick = <TValue>(current: TValue, previous: TValue, next: TValue): TValue =>
    Object.is(current, previous) ? next : current
  const contributed: Record<string, unknown> = { ...nextBaseline.contributed }
  for (const [id, value] of Object.entries(draft.contributed)) {
    contributed[id] = pick(value, previousBaseline.contributed[id], nextBaseline.contributed[id])
  }
  return {
    roundingUnitMinutes: pick(draft.roundingUnitMinutes, previousBaseline.roundingUnitMinutes, nextBaseline.roundingUnitMinutes),
    roundingDirection: pick(draft.roundingDirection, previousBaseline.roundingDirection, nextBaseline.roundingDirection),
    defaultsBillable: pick(draft.defaultsBillable, previousBaseline.defaultsBillable, nextBaseline.defaultsBillable),
    defaultsChainStartFromPreviousEnd: pick(
      draft.defaultsChainStartFromPreviousEnd,
      previousBaseline.defaultsChainStartFromPreviousEnd,
      nextBaseline.defaultsChainStartFromPreviousEnd,
    ),
    dailyHoursText: pick(draft.dailyHoursText, previousBaseline.dailyHoursText, nextBaseline.dailyHoursText),
    warningsOverlap: pick(draft.warningsOverlap, previousBaseline.warningsOverlap, nextBaseline.warningsOverlap),
    warningsRunningTimer: pick(draft.warningsRunningTimer, previousBaseline.warningsRunningTimer, nextBaseline.warningsRunningTimer),
    assignmentGraceDaysText: pick(
      draft.assignmentGraceDaysText,
      previousBaseline.assignmentGraceDaysText,
      nextBaseline.assignmentGraceDaysText,
    ),
    supportReferencePrefix: pick(
      draft.supportReferencePrefix,
      previousBaseline.supportReferencePrefix,
      nextBaseline.supportReferencePrefix,
    ),
    contributed,
  }
}

export function isSettingsDraftDirty(
  draft: TimeTrackingSettingsDraft,
  baseline: TimeTrackingSettingsDraft,
): boolean {
  return (
    draft.roundingUnitMinutes !== baseline.roundingUnitMinutes ||
    draft.roundingDirection !== baseline.roundingDirection ||
    draft.defaultsBillable !== baseline.defaultsBillable ||
    draft.defaultsChainStartFromPreviousEnd !== baseline.defaultsChainStartFromPreviousEnd ||
    draft.dailyHoursText.trim() !== baseline.dailyHoursText.trim() ||
    draft.warningsOverlap !== baseline.warningsOverlap ||
    draft.warningsRunningTimer !== baseline.warningsRunningTimer ||
    draft.assignmentGraceDaysText.trim() !== baseline.assignmentGraceDaysText.trim() ||
    contributedTimeTrackingSettingKeys().some(
      (entry) => !Object.is(draft.contributed[entry.id], baseline.contributed[entry.id]),
    )
  )
}
