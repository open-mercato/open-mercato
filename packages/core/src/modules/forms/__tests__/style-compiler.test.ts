import {
  compileFieldStyle,
  compileFormTheme,
  compileSectionStyle,
  type ResolvedStyle,
} from '../services/style-compiler'
import type {
  OmFieldStyle,
  OmSectionStyle,
  OmTheme,
} from '../schema/style-extensions'

/**
 * R-CS-1 guarantee: every emitted cssVars value must match one of the bounded
 * forms below — there is no string an author can persist that becomes an
 * arbitrary/parsed CSS declaration.
 */
const HEX = /^#([0-9a-fA-F]{3,8})$/
const VAR_REF = /^var\(--[a-z-]+\)$/
const GRADIENT = /^linear-gradient\((360|3[0-5][0-9]|[12]?[0-9]?[0-9])deg, #([0-9a-fA-F]{3,8}), #([0-9a-fA-F]{3,8})\)$/
const FONT_STACKS = new Set([
  'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  'ui-sans-serif, system-ui, sans-serif',
  'ui-serif, Georgia, Cambria, serif',
  'ui-monospace, SFMono-Regular, Menlo, monospace',
  'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
])
const RADIUS_LITERALS = new Set(['0px', '0.375rem', '0.625rem', '0.875rem', '9999px'])
const FONT_WEIGHTS = new Set(['400', '500', '600', '700'])

function assertValueAllowlisted(value: string): void {
  const allowed =
    HEX.test(value) ||
    VAR_REF.test(value) ||
    value === 'transparent' ||
    value === 'inherit' ||
    GRADIENT.test(value) ||
    FONT_STACKS.has(value) ||
    RADIUS_LITERALS.has(value) ||
    FONT_WEIGHTS.has(value)
  expect({ value, allowed }).toEqual({ value, allowed: true })
}

function assertResolvedStyleSafe(resolved: ResolvedStyle): void {
  for (const value of Object.values(resolved.cssVars)) {
    assertValueAllowlisted(value)
  }
}

describe('compileFormTheme — token → DS var mapping', () => {
  it('maps each curated color token to its allowlisted var reference', () => {
    expect(compileFormTheme({ surface: 'surface' }).cssVars).toEqual({ '--card': 'var(--card)' })
    expect(compileFormTheme({ surface: 'surface-muted' }).cssVars).toEqual({ '--card': 'var(--muted)' })
    expect(compileFormTheme({ foreground: 'foreground' }).cssVars).toEqual({ '--foreground': 'var(--foreground)' })
    expect(compileFormTheme({ foreground: 'muted-foreground' }).cssVars).toEqual({
      '--foreground': 'var(--muted-foreground)',
    })
    expect(compileFormTheme({ accent: 'accent' }).cssVars).toEqual({
      '--primary': 'var(--primary)',
      '--ring': 'var(--primary)',
    })
    expect(compileFormTheme({ border: 'border' }).cssVars).toEqual({
      '--border': 'var(--border)',
      '--input': 'var(--border)',
    })
    expect(compileFormTheme({ surface: 'transparent' }).cssVars).toEqual({ '--card': 'transparent' })
    expect(compileFormTheme({ foreground: 'inherit' }).cssVars).toEqual({ '--foreground': 'inherit' })
  })

  it('maps accent to both --primary and --ring; border to both --border and --input', () => {
    const accent = compileFormTheme({ accent: '#0f766e' }).cssVars
    expect(accent).toEqual({ '--primary': '#0f766e', '--ring': '#0f766e' })
    const border = compileFormTheme({ border: '#abc' }).cssVars
    expect(border).toEqual({ '--border': '#abc', '--input': '#abc' })
  })

  it('resolves a hex surface/foreground to the literal hex', () => {
    expect(compileFormTheme({ surface: '#123abc' }).cssVars['--card']).toBe('#123abc')
    expect(compileFormTheme({ foreground: '#0f766eff' }).cssVars['--foreground']).toBe('#0f766eff')
  })

  it('maps the radius scale to fixed literals', () => {
    expect(compileFormTheme({ radius: 'none' }).cssVars['--radius']).toBe('0px')
    expect(compileFormTheme({ radius: 'sm' }).cssVars['--radius']).toBe('0.375rem')
    expect(compileFormTheme({ radius: 'md' }).cssVars['--radius']).toBe('0.625rem')
    expect(compileFormTheme({ radius: 'lg' }).cssVars['--radius']).toBe('0.875rem')
    expect(compileFormTheme({ radius: 'full' }).cssVars['--radius']).toBe('9999px')
  })

  it('maps fontFamily to the allowlisted stacks', () => {
    expect(compileFormTheme({ fontFamily: 'system' }).cssVars['fontFamily']).toBe(
      'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    )
    expect(compileFormTheme({ fontFamily: 'sans' }).cssVars['fontFamily']).toBe('ui-sans-serif, system-ui, sans-serif')
    expect(compileFormTheme({ fontFamily: 'serif' }).cssVars['fontFamily']).toBe('ui-serif, Georgia, Cambria, serif')
    expect(compileFormTheme({ fontFamily: 'mono' }).cssVars['fontFamily']).toBe(
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    )
    expect(compileFormTheme({ fontFamily: 'rounded' }).cssVars['fontFamily']).toBe(
      'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    )
  })

  it('maps fontScale and contentWidth to classNames (not cssVars)', () => {
    expect(compileFormTheme({ fontScale: 'sm' }).classNames).toEqual(['text-sm'])
    expect(compileFormTheme({ fontScale: 'md' }).classNames).toEqual(['text-base'])
    expect(compileFormTheme({ fontScale: 'lg' }).classNames).toEqual(['text-lg'])
    expect(compileFormTheme({ contentWidth: 'sm' }).classNames).toEqual(['max-w-md'])
    expect(compileFormTheme({ contentWidth: 'md' }).classNames).toEqual(['max-w-2xl'])
    expect(compileFormTheme({ contentWidth: 'lg' }).classNames).toEqual(['max-w-4xl'])
    expect(compileFormTheme({ contentWidth: 'full' }).classNames).toEqual(['max-w-none'])
  })

  it('color background sets both --background and background; gradient sets backgroundImage only', () => {
    const color = compileFormTheme({ background: { kind: 'color', color: '#0f766e' } }).cssVars
    expect(color).toEqual({ '--background': '#0f766e', background: '#0f766e' })

    const gradient = compileFormTheme({
      background: { kind: 'gradient', from: '#000', to: '#fff', angle: 90 },
    }).cssVars
    expect(gradient).toEqual({ backgroundImage: 'linear-gradient(90deg, #000, #fff)' })
    expect(gradient['--background']).toBeUndefined()

    expect(compileFormTheme({ background: { kind: 'none' } }).cssVars).toEqual({})
  })

  it('emits form-wide label color/weight as --om-label-* vars + marker classes (distinct from body text)', () => {
    const labelColor = compileFormTheme({ labelColor: '#0f766e' })
    expect(labelColor.cssVars['--om-label-color']).toBe('#0f766e')
    expect(labelColor.classNames).toContain('om-form-label-color')
    const labelWeight = compileFormTheme({ labelWeight: 'bold' })
    expect(labelWeight.cssVars['--om-label-weight']).toBe('700')
    expect(labelWeight.classNames).toContain('om-form-label-weight')
    // Body text stays the separate --foreground remap.
    const both = compileFormTheme({ foreground: '#111111', labelColor: '#0f766e' })
    expect(both.cssVars['--foreground']).toBe('#111111')
    expect(both.cssVars['--om-label-color']).toBe('#0f766e')
  })

  it('emits form-wide input text as --om-text-color (overrides body text on input/textarea/select)', () => {
    const inputs = compileFormTheme({ inputText: '#0ea5e9' })
    expect(inputs.cssVars['--om-text-color']).toBe('#0ea5e9')
    // No marker class — the form-scope rule reads --om-text-color directly,
    // and a per-field var override wins by proximity.
    expect(inputs.classNames).not.toContain('om-form-input-text')
    // Body text and input text are independent.
    const both = compileFormTheme({ foreground: '#111111', inputText: '#ffffff' })
    expect(both.cssVars['--foreground']).toBe('#111111')
    expect(both.cssVars['--om-text-color']).toBe('#ffffff')
  })
})

describe('compileSectionStyle', () => {
  it('maps padding / border / radius / align to classNames', () => {
    expect(compileSectionStyle({ padding: 'none' }).classNames).toEqual(['p-0'])
    expect(compileSectionStyle({ padding: 'xs' }).classNames).toEqual(['p-2'])
    expect(compileSectionStyle({ padding: 'sm' }).classNames).toEqual(['p-3'])
    expect(compileSectionStyle({ padding: 'md' }).classNames).toEqual(['p-4'])
    expect(compileSectionStyle({ padding: 'lg' }).classNames).toEqual(['p-6'])
    expect(compileSectionStyle({ padding: 'xl' }).classNames).toEqual(['p-8'])

    expect(compileSectionStyle({ border: 'none' }).classNames).toEqual(['border-0'])
    expect(compileSectionStyle({ border: 'subtle' }).classNames).toEqual(['border border-border'])
    expect(compileSectionStyle({ border: 'strong' }).classNames).toEqual(['border-2 border-border'])

    expect(compileSectionStyle({ radius: 'none' }).classNames).toEqual(['rounded-none'])
    expect(compileSectionStyle({ radius: 'sm' }).classNames).toEqual(['rounded-sm'])
    expect(compileSectionStyle({ radius: 'md' }).classNames).toEqual(['rounded-md'])
    expect(compileSectionStyle({ radius: 'lg' }).classNames).toEqual(['rounded-lg'])
    expect(compileSectionStyle({ radius: 'full' }).classNames).toEqual(['rounded-full'])

    expect(compileSectionStyle({ align: 'start' }).classNames).toEqual(['text-left'])
    expect(compileSectionStyle({ align: 'center' }).classNames).toEqual(['text-center'])
    expect(compileSectionStyle({ align: 'end' }).classNames).toEqual(['text-right'])
  })

  it('emits the fixed card class set', () => {
    expect(compileSectionStyle({ card: true }).classNames).toEqual([
      'bg-card',
      'shadow-sm',
      'border',
      'border-border',
      'rounded-lg',
    ])
    expect(compileSectionStyle({ card: false }).classNames).toEqual([])
  })

  it('foreground sets color and --foreground; background follows the color/gradient handling', () => {
    expect(compileSectionStyle({ foreground: '#222' }).cssVars).toEqual({ color: '#222', '--foreground': '#222' })
    expect(compileSectionStyle({ background: { kind: 'color', color: 'surface' } }).cssVars).toEqual({
      background: 'var(--card)',
    })
    expect(
      compileSectionStyle({ background: { kind: 'gradient', from: '#000', to: '#fff', angle: 45 } }).cssVars,
    ).toEqual({ backgroundImage: 'linear-gradient(45deg, #000, #fff)' })
  })
})

describe('compileFieldStyle', () => {
  it('maps labelWeight to a label-element font class', () => {
    expect(compileFieldStyle({ labelWeight: 'normal' }).classNames).toEqual(['font-normal'])
    expect(compileFieldStyle({ labelWeight: 'medium' }).classNames).toEqual(['font-medium'])
    expect(compileFieldStyle({ labelWeight: 'semibold' }).classNames).toEqual(['font-semibold'])
    expect(compileFieldStyle({ labelWeight: 'bold' }).classNames).toEqual(['font-bold'])
  })

  it('exposes label/text colors as --om-* cssVars and accent on both var and accentColor', () => {
    expect(compileFieldStyle({ labelColor: '#0f766e' }).cssVars).toEqual({ '--om-label-color': '#0f766e' })
    expect(compileFieldStyle({ textColor: 'muted-foreground' }).cssVars).toEqual({
      '--om-text-color': 'var(--muted-foreground)',
    })
    expect(compileFieldStyle({ accent: '#abc' }).cssVars).toEqual({
      '--om-field-accent': '#abc',
      accentColor: '#abc',
    })
  })

  it('maps align to a text alignment class', () => {
    expect(compileFieldStyle({ align: 'start' }).classNames).toEqual(['text-left'])
    expect(compileFieldStyle({ align: 'center' }).classNames).toEqual(['text-center'])
    expect(compileFieldStyle({ align: 'end' }).classNames).toEqual(['text-right'])
  })

  it('pairs each color var with the marker class that binds it (the dead-var fix)', () => {
    // The `--om-*` var alone is inert — globals.css binds it to `color` only via
    // the marker class. Emit the class iff the color resolves.
    expect(compileFieldStyle({ labelColor: '#0f766e' }).classNames).toContain('om-field-label-color')
    expect(compileFieldStyle({ textColor: 'muted-foreground' }).classNames).toContain('om-field-text-color')
    // No color ⇒ no marker class ⇒ field stays byte-identical (R-CS-6).
    expect(compileFieldStyle({ labelWeight: 'bold' }).classNames).not.toContain('om-field-label-color')
    expect(compileFieldStyle({ labelWeight: 'bold' }).classNames).not.toContain('om-field-text-color')
    // An invalid color resolves to null ⇒ neither var nor marker class.
    const invalid = compileFieldStyle({ labelColor: 'rgb(0,0,0)' as never })
    expect(invalid.cssVars['--om-label-color']).toBeUndefined()
    expect(invalid.classNames).not.toContain('om-field-label-color')
  })
})

describe('gradient template exactness', () => {
  it('clamps the angle into [0, 360] and rounds non-integers', () => {
    expect(
      compileFormTheme({ background: { kind: 'gradient', from: '#000', to: '#fff', angle: 999 } }).cssVars[
        'backgroundImage'
      ],
    ).toBe('linear-gradient(360deg, #000, #fff)')
    expect(
      compileFormTheme({ background: { kind: 'gradient', from: '#000', to: '#fff', angle: -45 } }).cssVars[
        'backgroundImage'
      ],
    ).toBe('linear-gradient(0deg, #000, #fff)')
    expect(
      compileFormTheme({ background: { kind: 'gradient', from: '#000', to: '#fff', angle: 90.6 } }).cssVars[
        'backgroundImage'
      ],
    ).toBe('linear-gradient(91deg, #000, #fff)')
  })

  it('omits a gradient with a non-hex stop (token stops are not allowed in gradients)', () => {
    const tokenStop = compileFormTheme({
      background: { kind: 'gradient', from: 'accent' as never, to: '#fff', angle: 90 },
    }).cssVars
    expect(tokenStop['backgroundImage']).toBeUndefined()
    assertResolvedStyleSafe({ cssVars: tokenStop, classNames: [] })
  })
})

describe('R-CS-1 — every emitted value is allowlisted; unknown tokens are omitted', () => {
  it('emits only allowlisted values for a fully-populated theme', () => {
    const theme: OmTheme = {
      background: { kind: 'gradient', from: '#0f766e', to: '#134e4a', angle: 135 },
      surface: '#ffffff',
      foreground: 'foreground',
      accent: '#0f766e',
      border: 'border',
      fontFamily: 'rounded',
      fontScale: 'lg',
      radius: 'lg',
      contentWidth: 'md',
    }
    const resolved = compileFormTheme(theme)
    assertResolvedStyleSafe(resolved)
  })

  it('emits only allowlisted values for fully-populated section + field styles', () => {
    const section: OmSectionStyle = {
      background: { kind: 'color', color: 'surface-muted' },
      foreground: '#101010',
      padding: 'lg',
      border: 'strong',
      radius: 'md',
      card: true,
      align: 'center',
    }
    const field: OmFieldStyle = {
      labelWeight: 'bold',
      labelColor: '#0f766e',
      textColor: 'muted-foreground',
      accent: '#abcdef',
      align: 'end',
    }
    assertResolvedStyleSafe(compileSectionStyle(section))
    assertResolvedStyleSafe(compileFieldStyle(field))
  })

  it('omits a color that is not a curated token nor a strict hex (defensive re-validation)', () => {
    const malicious = { surface: 'red;}body{background:red}' } as unknown as OmTheme
    const resolved = compileFormTheme(malicious)
    expect(resolved.cssVars['--card']).toBeUndefined()
    expect(resolved).toEqual({ cssVars: {}, classNames: [] })

    const injection = { foreground: 'var(--evil)' } as unknown as OmTheme
    expect(compileFormTheme(injection).cssVars['--foreground']).toBeUndefined()

    const unknownToken = { accent: 'brandolicious' } as unknown as OmTheme
    expect(compileFormTheme(unknownToken).cssVars['--primary']).toBeUndefined()
  })

  it('omits unknown enum members for scales / families / aligns', () => {
    expect(compileFormTheme({ radius: 'huge' as never }).cssVars['--radius']).toBeUndefined()
    expect(compileFormTheme({ fontFamily: 'comic' as never }).cssVars['fontFamily']).toBeUndefined()
    expect(compileFormTheme({ fontScale: 'xxl' as never }).classNames).toEqual([])
    expect(compileSectionStyle({ padding: 'massive' as never }).classNames).toEqual([])
    expect(compileFieldStyle({ align: 'justify' as never }).classNames).toEqual([])
  })
})

describe('absent / empty input', () => {
  it('returns an empty result for undefined / null / empty objects', () => {
    const empty = { cssVars: {}, classNames: [] }
    expect(compileFormTheme(undefined)).toEqual(empty)
    expect(compileFormTheme(null)).toEqual(empty)
    expect(compileFormTheme({})).toEqual(empty)
    expect(compileSectionStyle(undefined)).toEqual(empty)
    expect(compileSectionStyle(null)).toEqual(empty)
    expect(compileSectionStyle({})).toEqual(empty)
    expect(compileFieldStyle(undefined)).toEqual(empty)
    expect(compileFieldStyle(null)).toEqual(empty)
    expect(compileFieldStyle({})).toEqual(empty)
  })
})
