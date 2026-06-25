import { buildEditorCategoryOptions } from '../editorPayload'

const TYPE_LABELS = { meeting: 'Meeting', call: 'Call', email: 'Email' }

function labels(options: Array<{ value: string; label: string }>): string[] {
  return options.map((option) => option.label)
}

describe('buildEditorCategoryOptions', () => {
  it('returns all dictionary options when no preferences are set', () => {
    const options = buildEditorCategoryOptions({
      typeLabels: TYPE_LABELS,
      surfacedTypes: [],
      eventCategories: [],
      selectedValue: 'meeting',
      selectedFallbackLabel: 'Meeting',
    })
    expect(labels(options).sort()).toEqual(['Call', 'Email', 'Meeting'])
  })

  it('filters dictionary types to the surfaced activity-types set', () => {
    const options = buildEditorCategoryOptions({
      typeLabels: TYPE_LABELS,
      surfacedTypes: ['Meeting', 'Call'],
      eventCategories: [],
      selectedValue: 'meeting',
      selectedFallbackLabel: 'Meeting',
    })
    expect(labels(options).sort()).toEqual(['Call', 'Meeting'])
    // dictionary entries keep their canonical key as the value
    expect(options.find((option) => option.label === 'Meeting')?.value).toBe('meeting')
  })

  it('appends custom event categories as quick-pick options keyed by their label', () => {
    const options = buildEditorCategoryOptions({
      typeLabels: TYPE_LABELS,
      surfacedTypes: [],
      eventCategories: ['Workshop'],
      selectedValue: 'meeting',
      selectedFallbackLabel: 'Meeting',
    })
    const workshop = options.find((option) => option.label === 'Workshop')
    expect(workshop).toEqual({ value: 'Workshop', label: 'Workshop' })
  })

  it('treats a surfaced label with no dictionary match as a custom option', () => {
    const options = buildEditorCategoryOptions({
      typeLabels: TYPE_LABELS,
      surfacedTypes: ['Meeting', 'Workshop'],
      eventCategories: [],
      selectedValue: 'meeting',
      selectedFallbackLabel: 'Meeting',
    })
    expect(labels(options).sort()).toEqual(['Meeting', 'Workshop'])
  })

  it('does not duplicate a custom label that matches a dictionary label', () => {
    const options = buildEditorCategoryOptions({
      typeLabels: TYPE_LABELS,
      surfacedTypes: [],
      eventCategories: ['Meeting'],
      selectedValue: 'meeting',
      selectedFallbackLabel: 'Meeting',
    })
    expect(labels(options).filter((label) => label === 'Meeting')).toHaveLength(1)
  })

  it('always includes the selected value even when filtered or absent', () => {
    const options = buildEditorCategoryOptions({
      typeLabels: TYPE_LABELS,
      surfacedTypes: ['Call'],
      eventCategories: [],
      selectedValue: 'meeting',
      selectedFallbackLabel: 'Meeting',
    })
    expect(options.some((option) => option.value === 'meeting')).toBe(true)
  })
})
