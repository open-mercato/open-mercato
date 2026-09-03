/** @jest-environment node */
import {
  buildRoundingExamples,
  draftRounding,
  formatSignedMinutes,
  isSettingsDraftDirty,
  settingsDraftErrors,
  toSettingsDraft,
  toSettingsPayload,
} from '../timeTrackingSettingsForm'
import { DEFAULT_TIME_TRACKING_SETTINGS, type TimeTrackingSettings } from '../../time-tracking/settings'

const settings: TimeTrackingSettings = {
  rounding: { unitMinutes: 15, direction: 'up' },
  defaults: { billable: true, chainStartFromPreviousEnd: true },
  targets: { dailyHours: 8 },
  warnings: { overlap: true, runningTimer: true },
  access: { assignmentGraceDays: 14 },
}

describe('buildRoundingExamples', () => {
  it('reproduces the mockup line at 15 min up', () => {
    const rendered = buildRoundingExamples({ unitMinutes: 15, direction: 'up' })
      .map((example) => `${example.rawLabel} → ${example.roundedLabel}`)
      .join(' · ')

    expect(rendered).toBe('1:02 → 1:15 · 1:16 → 1:30 · 0:03 → 0:15 · 2:00 → 2:00')
  })

  it('recomputes when the unit changes', () => {
    const rendered = buildRoundingExamples({ unitMinutes: 5, direction: 'up' })
      .map((example) => `${example.rawLabel} → ${example.roundedLabel}`)
      .join(' · ')

    expect(rendered).toBe('1:02 → 1:05 · 1:16 → 1:20 · 0:03 → 0:05 · 2:00 → 2:00')
  })

  it('recomputes when the direction changes', () => {
    const rendered = buildRoundingExamples({ unitMinutes: 15, direction: 'nearest' })
      .map((example) => `${example.rawLabel} → ${example.roundedLabel}`)
      .join(' · ')

    expect(rendered).toBe('1:02 → 1:00 · 1:16 → 1:15 · 0:03 → 0:00 · 2:00 → 2:00')
  })

  it('leaves every example untouched when rounding is off', () => {
    for (const example of buildRoundingExamples({ unitMinutes: 0, direction: 'up' })) {
      expect(example.roundedMinutes).toBe(example.rawMinutes)
    }
  })
})

describe('formatSignedMinutes', () => {
  it('signs a gain, a loss and a wash', () => {
    expect(formatSignedMinutes(2295)).toBe('+38:15')
    expect(formatSignedMinutes(-750)).toBe('−12:30')
    expect(formatSignedMinutes(0)).toBe('0:00')
  })
})

describe('settings draft', () => {
  it('round-trips a settings record', () => {
    const draft = toSettingsDraft(settings)
    expect(draft.dailyHoursText).toBe('8')
    expect(draft.assignmentGraceDaysText).toBe('14')
    expect(toSettingsPayload(draft)).toEqual(settings)
  })

  it('keeps an empty daily target as a real null rather than a default', () => {
    const draft = toSettingsDraft({ ...settings, targets: { dailyHours: null } })
    expect(draft.dailyHoursText).toBe('')
    expect(settingsDraftErrors(draft)).toEqual([])
    expect(toSettingsPayload(draft)?.targets.dailyHours).toBeNull()
  })

  it('preserves what the user typed instead of coercing it', () => {
    const draft = { ...toSettingsDraft(settings), dailyHoursText: '7.' }
    expect(draft.dailyHoursText).toBe('7.')
    expect(settingsDraftErrors(draft)).toEqual([])
  })

  it('rejects an out-of-range daily target and refuses to build a payload', () => {
    const draft = { ...toSettingsDraft(settings), dailyHoursText: '30' }
    expect(settingsDraftErrors(draft)).toEqual(['dailyHours'])
    expect(toSettingsPayload(draft)).toBeNull()
  })

  it('rejects a fractional or out-of-range grace period', () => {
    expect(settingsDraftErrors({ ...toSettingsDraft(settings), assignmentGraceDaysText: '1.5' })).toEqual([
      'assignmentGraceDays',
    ])
    expect(settingsDraftErrors({ ...toSettingsDraft(settings), assignmentGraceDaysText: '400' })).toEqual([
      'assignmentGraceDays',
    ])
    expect(settingsDraftErrors({ ...toSettingsDraft(settings), assignmentGraceDaysText: '' })).toEqual([
      'assignmentGraceDays',
    ])
  })

  it('accepts a zero grace period, which ends access on the end date', () => {
    const draft = { ...toSettingsDraft(settings), assignmentGraceDaysText: '0' }
    expect(settingsDraftErrors(draft)).toEqual([])
    expect(toSettingsPayload(draft)?.access.assignmentGraceDays).toBe(0)
  })

  it('carries the access group through the payload it did not have a UI for before', () => {
    const draft = { ...toSettingsDraft(settings), assignmentGraceDaysText: '30' }
    expect(toSettingsPayload(draft)).toEqual({ ...settings, access: { assignmentGraceDays: 30 } })
  })

  it('tracks dirtiness per field and ignores surrounding whitespace', () => {
    const baseline = toSettingsDraft(settings)
    expect(isSettingsDraftDirty(baseline, baseline)).toBe(false)
    expect(isSettingsDraftDirty({ ...baseline, dailyHoursText: ' 8 ' }, baseline)).toBe(false)
    expect(isSettingsDraftDirty({ ...baseline, dailyHoursText: '7' }, baseline)).toBe(true)
    expect(isSettingsDraftDirty({ ...baseline, roundingUnitMinutes: 5 }, baseline)).toBe(true)
    expect(isSettingsDraftDirty({ ...baseline, roundingDirection: 'nearest' }, baseline)).toBe(true)
    expect(isSettingsDraftDirty({ ...baseline, defaultsBillable: false }, baseline)).toBe(true)
    expect(isSettingsDraftDirty({ ...baseline, warningsOverlap: false }, baseline)).toBe(true)
    expect(isSettingsDraftDirty({ ...baseline, assignmentGraceDaysText: '0' }, baseline)).toBe(true)
  })

  it('exposes the candidate rounding rule the preview is driven by', () => {
    const draft = { ...toSettingsDraft(settings), roundingUnitMinutes: 10 as const, roundingDirection: 'nearest' as const }
    expect(draftRounding(draft)).toEqual({ unitMinutes: 10, direction: 'nearest' })
  })

  it('round-trips the shipped defaults', () => {
    expect(toSettingsPayload(toSettingsDraft(DEFAULT_TIME_TRACKING_SETTINGS))).toEqual(
      DEFAULT_TIME_TRACKING_SETTINGS,
    )
  })
})
