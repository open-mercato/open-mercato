/**
 * Phase B unit tests for the studio palette's "Survey & Contact" group
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Asserts:
 * - `buildPaletteEntries()` returns a 3-key shape `{ input, survey, layout }`.
 * - `email`, `phone`, `website` register under the new `survey` bucket.
 * - The same three keys are absent from the legacy `input` bucket so the
 *   palette doesn't double-list them.
 * - `SURVEY_TYPE_KEYS` is the single source of truth so Phases C–F can append
 *   their type keys.
 */

import {
  buildPaletteEntries,
  SURVEY_TYPE_KEYS,
} from '../backend/forms/[id]/studio/palette/entries'

describe('palette — Survey & Contact group (Phase B)', () => {
  it('exposes input / survey / layout buckets', () => {
    const entries = buildPaletteEntries()
    expect(entries).toHaveProperty('input')
    expect(entries).toHaveProperty('survey')
    expect(entries).toHaveProperty('layout')
  })

  it('places email / phone / website / address / nps / opinion_scale / ranking / matrix under survey', () => {
    const { survey } = buildPaletteEntries()
    const keys = survey.map((entry) => entry.fieldTypeKey ?? entry.id)
    expect(keys).toEqual(
      expect.arrayContaining([
        'email',
        'phone',
        'website',
        'address',
        'nps',
        'opinion_scale',
        'ranking',
        'matrix',
      ]),
    )
  })

  it('does not duplicate survey types into the input bucket', () => {
    const { input } = buildPaletteEntries()
    const inputKeys = input.map((entry) => entry.fieldTypeKey ?? entry.id)
    expect(inputKeys).not.toContain('email')
    expect(inputKeys).not.toContain('phone')
    expect(inputKeys).not.toContain('website')
    expect(inputKeys).not.toContain('address')
    expect(inputKeys).not.toContain('nps')
    expect(inputKeys).not.toContain('opinion_scale')
    expect(inputKeys).not.toContain('ranking')
    expect(inputKeys).not.toContain('matrix')
  })

  it('SURVEY_TYPE_KEYS seeds the Phase B + Phase C + Phase D + Phase E + Phase F types', () => {
    expect(SURVEY_TYPE_KEYS.has('email')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('phone')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('website')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('address')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('nps')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('opinion_scale')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('ranking')).toBe(true)
    expect(SURVEY_TYPE_KEYS.has('matrix')).toBe(true)
  })

  it('survey entries carry the matching lucide icon and display key', () => {
    const { survey } = buildPaletteEntries()
    const byKey = new Map(survey.map((entry) => [entry.fieldTypeKey ?? entry.id, entry]))
    expect(byKey.get('email')?.iconName).toBe('mail')
    expect(byKey.get('phone')?.iconName).toBe('phone')
    expect(byKey.get('website')?.iconName).toBe('globe')
    expect(byKey.get('address')?.iconName).toBe('map-pin')
    expect(byKey.get('nps')?.iconName).toBe('gauge')
    expect(byKey.get('opinion_scale')?.iconName).toBe('star')
    expect(byKey.get('ranking')?.iconName).toBe('list-ordered')
    expect(byKey.get('matrix')?.iconName).toBe('grid-3x3')
    expect(byKey.get('email')?.displayNameKey).toBe('forms.studio.palette.survey.email')
    expect(byKey.get('phone')?.displayNameKey).toBe('forms.studio.palette.survey.phone')
    expect(byKey.get('website')?.displayNameKey).toBe('forms.studio.palette.survey.website')
    expect(byKey.get('address')?.displayNameKey).toBe('forms.studio.palette.survey.address')
    expect(byKey.get('nps')?.displayNameKey).toBe('forms.studio.palette.survey.nps')
    expect(byKey.get('opinion_scale')?.displayNameKey).toBe('forms.studio.palette.survey.opinion')
    expect(byKey.get('ranking')?.displayNameKey).toBe('forms.studio.palette.survey.ranking')
    expect(byKey.get('matrix')?.displayNameKey).toBe('forms.studio.palette.survey.matrix')
  })

  it('survey entries are draggable as inputs (category: input)', () => {
    const { survey } = buildPaletteEntries()
    for (const entry of survey) {
      expect(entry.category).toBe('input')
    }
  })
})
