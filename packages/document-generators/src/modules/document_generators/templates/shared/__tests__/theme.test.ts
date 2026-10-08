import { documentTheme } from '../theme'

describe('PDF authoring theme', () => {
  it('leaves the font to the page default and keeps ordered print spacing', () => {
    expect(documentTheme).not.toHaveProperty('fontFamily')
    expect(Object.values(documentTheme.spacing)).toEqual([4, 8, 16, 24, 32])
    expect(documentTheme.fontSize.body).toBeGreaterThan(documentTheme.fontSize.small)
    expect(documentTheme.colors.foreground).not.toBe(documentTheme.colors.background)
  })
})
