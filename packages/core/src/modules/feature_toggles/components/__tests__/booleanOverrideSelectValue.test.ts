/** @jest-environment node */

import { booleanOverrideSelectValue } from '../overrideFormConfig'

// Guards BOTH boolean <Select> call sites: the per-tenant override card
// (overrideFormConfig.renderOverrideValueComponent) and the GLOBAL toggle
// default-value form (formConfig.renderDefaultValueCreateComponent). The
// latter previously bound `props.value as string || 'false'`, which leaked a
// real boolean `true` straight into <Select value>, matched no <SelectItem>,
// and rendered blank (QA round-6 follow-up to #2410).
describe('booleanOverrideSelectValue (#2410)', () => {
  it('maps the boolean true to "true" (a stored boolean must not render blank)', () => {
    expect(booleanOverrideSelectValue(true)).toBe('true')
  })

  it('maps the boolean false to "false"', () => {
    expect(booleanOverrideSelectValue(false)).toBe('false')
  })

  it('maps the string "true"/"false" through unchanged', () => {
    expect(booleanOverrideSelectValue('true')).toBe('true')
    expect(booleanOverrideSelectValue('false')).toBe('false')
  })

  it('falls back to "false" for undefined/null/other', () => {
    expect(booleanOverrideSelectValue(undefined)).toBe('false')
    expect(booleanOverrideSelectValue(null)).toBe('false')
    expect(booleanOverrideSelectValue('')).toBe('false')
  })
})
