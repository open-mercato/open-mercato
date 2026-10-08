import { withoutInternalPrefix } from '../withoutInternalPrefix'

describe('withoutInternalPrefix', () => {
  it('returns the error message without the internal prefix', () => {
    expect(withoutInternalPrefix(new Error('[internal] Font file not found: /a.ttf'))).toBe('Font file not found: /a.ttf')
    expect(withoutInternalPrefix(new RangeError('Offset is outside the bounds of the DataView'))).toBe('Offset is outside the bounds of the DataView')
  })

  it('stringifies values that are not errors', () => {
    expect(withoutInternalPrefix('[internal] broken')).toBe('broken')
    expect(withoutInternalPrefix(42)).toBe('42')
  })
})
