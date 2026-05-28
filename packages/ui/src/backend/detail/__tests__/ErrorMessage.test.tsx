import { formatErrorMessageLabel } from '../ErrorMessage'

describe('formatErrorMessageLabel', () => {
  it('keeps normal user-facing labels unchanged', () => {
    expect(formatErrorMessageLabel('Failed to load product details.')).toBe('Failed to load product details.')
  })

  it('formats technical snake-case labels into readable text', () => {
    expect(formatErrorMessageLabel('load_failed')).toBe('Load failed')
  })

  it('uses the meaningful tail of dotted error keys', () => {
    expect(formatErrorMessageLabel('catalog.products.load_failed')).toBe('Load failed')
  })
})
