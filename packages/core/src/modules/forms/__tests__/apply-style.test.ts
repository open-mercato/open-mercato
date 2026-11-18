/**
 * Unit tests for the runtime apply-seam helper `styleProps`
 * (`.ai/specs/2026-05-22-forms-custom-styling.md` Step 5 / R-CS-7).
 *
 * Pure — no DOM render. Asserts `cssVars` flow into the React `style` object,
 * `classNames` + extra classes are joined, and an empty `ResolvedStyle` yields
 * an empty style with only the extra classes.
 */
import { styleProps } from '../ui/public/style/applyStyle'
import type { ResolvedStyle } from '../services/style-compiler'

describe('styleProps', () => {
  it('merges cssVars into the style object', () => {
    const resolved: ResolvedStyle = {
      cssVars: { '--card': '#0f766e', '--radius': '0.625rem', background: '#ffffff' },
      classNames: [],
    }
    const { style } = styleProps(resolved)
    expect(style).toEqual({ '--card': '#0f766e', '--radius': '0.625rem', background: '#ffffff' })
  })

  it('joins classNames with extra classes', () => {
    const resolved: ResolvedStyle = {
      cssVars: {},
      classNames: ['text-base', 'max-w-4xl'],
    }
    const { className } = styleProps(resolved, 'flex flex-col gap-4')
    expect(className.split(' ').sort()).toEqual(
      ['flex', 'flex-col', 'gap-4', 'max-w-4xl', 'text-base'].sort(),
    )
  })

  it('ignores undefined extra classes', () => {
    const resolved: ResolvedStyle = { cssVars: {}, classNames: ['text-lg'] }
    const { className } = styleProps(resolved, undefined, 'text-center')
    expect(className.split(' ').sort()).toEqual(['text-center', 'text-lg'].sort())
  })

  it('returns an empty style and only extra classes for an empty ResolvedStyle', () => {
    const empty: ResolvedStyle = { cssVars: {}, classNames: [] }
    expect(styleProps(empty)).toEqual({ style: {}, className: '' })
    expect(styleProps(empty, 'flex flex-col gap-4')).toEqual({
      style: {},
      className: 'flex flex-col gap-4',
    })
  })
})
