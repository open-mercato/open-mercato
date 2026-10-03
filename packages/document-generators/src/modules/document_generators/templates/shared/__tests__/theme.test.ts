import { documentTheme } from '../theme'

describe('PDF authoring theme', () => {
  it('uses a built-in font and ordered print spacing without font-registration side effects', () => {
    expect(documentTheme.fontFamily).toBe('Helvetica')
    expect(Object.values(documentTheme.spacing)).toEqual([4, 8, 16, 24, 32])
    expect(documentTheme.fontSize.body).toBeGreaterThan(documentTheme.fontSize.small)
    expect(documentTheme.colors.foreground).not.toBe(documentTheme.colors.background)
  })
})
