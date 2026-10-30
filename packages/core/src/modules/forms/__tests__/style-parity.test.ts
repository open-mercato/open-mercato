/**
 * Preview ↔ runtime styling parity (`.ai/specs/2026-05-22-forms-custom-styling.md`
 * R-CS-7, Implementation Step 8).
 *
 * Both render paths consume the SAME pure functions:
 *   - `<FormRunner>` (`ui/public/FormRunner.tsx`) and
 *   - `<PreviewSurface>` (`backend/forms/[id]/studio/preview/PreviewSurface.tsx`)
 * each call `resolveFormTheme`/`resolveSectionStyle`/`resolveFieldStyle`
 * (from `form-version-compiler`) and feed the result through
 * `compileFormTheme`/`compileSectionStyle`/`compileFieldStyle` (from
 * `style-compiler`), then `styleProps` (from `ui/public/style/applyStyle`).
 *
 * Because both seams are wired to these identical functions, the structural
 * guarantee of parity is that exercising the pipeline ONCE here pins the exact
 * `ResolvedStyle` (cssVars + classNames) that BOTH surfaces apply at the
 * form/section/field seams. A divergence would require one surface to stop
 * calling these functions — which this test would not catch, but the imports in
 * both files (asserted manually in the spec/Task D and Task G) keep them locked.
 */
import {
  resolveFieldStyle,
  resolveFormTheme,
  resolveSectionStyle,
} from '../services/form-version-compiler'
import {
  compileFieldStyle,
  compileFormTheme,
  compileSectionStyle,
} from '../services/style-compiler'
import { styleProps } from '../ui/public/style/applyStyle'

const themedSchema: Record<string, unknown> = {
  type: 'object',
  'x-om-theme': {
    accent: '#0f766e',
    surface: '#ffffff',
    radius: 'md',
    fontFamily: 'serif',
    contentWidth: 'lg',
    background: { kind: 'color', color: '#f8fafc' },
  },
  'x-om-sections': [
    {
      key: 'intro',
      title: { en: 'Intro' },
      fieldKeys: ['name'],
      style: {
        card: true,
        padding: 'lg',
        align: 'center',
        foreground: '#111827',
      },
    },
  ],
  properties: {
    name: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-style': {
        labelWeight: 'bold',
        labelColor: '#0f766e',
        align: 'end',
      },
    },
  },
}

describe('preview ↔ runtime styling parity (R-CS-7)', () => {
  it('produces the expected form-theme ResolvedStyle that both paths apply', () => {
    const theme = resolveFormTheme(themedSchema)
    const resolved = compileFormTheme(theme)
    expect(resolved.cssVars).toEqual({
      '--card': '#ffffff',
      '--primary': '#0f766e',
      '--ring': '#0f766e',
      '--radius': '0.625rem',
      '--background': '#f8fafc',
      background: '#f8fafc',
      fontFamily: 'ui-serif, Georgia, Cambria, serif',
    })
    expect(resolved.classNames.sort()).toEqual(['max-w-4xl'].sort())

    const { style, className } = styleProps(resolved)
    expect(style).toEqual(resolved.cssVars)
    expect(className).toBe('max-w-4xl')
  })

  it('produces the expected section ResolvedStyle that both paths apply', () => {
    const section = (themedSchema['x-om-sections'] as Array<Record<string, unknown>>)[0]
    const sectionStyle = resolveSectionStyle(section)
    const resolved = compileSectionStyle(sectionStyle)
    expect(resolved.cssVars).toEqual({
      color: '#111827',
      '--foreground': '#111827',
    })
    expect(resolved.classNames.sort()).toEqual(
      ['p-6', 'text-center', 'bg-card', 'shadow-sm', 'border', 'border-border', 'rounded-lg'].sort(),
    )
  })

  it('produces the expected field ResolvedStyle that both paths apply', () => {
    const node = (themedSchema.properties as Record<string, Record<string, unknown>>).name
    const fieldStyle = resolveFieldStyle(node)
    const resolved = compileFieldStyle(fieldStyle)
    // `--om-label-weight` lets a per-field weight override a form-wide one by proximity.
    expect(resolved.cssVars).toEqual({ '--om-label-color': '#0f766e', '--om-label-weight': '700' })
    // `om-field-label-color` is the marker class that binds `--om-label-color`
    // to a real `color` (globals.css) — without it the var is inert.
    expect(resolved.classNames.sort()).toEqual(
      ['font-bold', 'text-right', 'om-field-label-color'].sort(),
    )
  })

  it('yields empty styling (byte-identical render) for an unstyled schema', () => {
    const unstyled: Record<string, unknown> = {
      type: 'object',
      'x-om-sections': [{ key: 's', title: { en: 'S' }, fieldKeys: ['f'] }],
      properties: { f: { type: 'string', 'x-om-type': 'text' } },
    }
    const formResolved = compileFormTheme(resolveFormTheme(unstyled))
    const sectionResolved = compileSectionStyle(
      resolveSectionStyle((unstyled['x-om-sections'] as Array<Record<string, unknown>>)[0]),
    )
    const fieldResolved = compileFieldStyle(
      resolveFieldStyle((unstyled.properties as Record<string, Record<string, unknown>>).f),
    )
    expect(formResolved).toEqual({ cssVars: {}, classNames: [] })
    expect(sectionResolved).toEqual({ cssVars: {}, classNames: [] })
    expect(fieldResolved).toEqual({ cssVars: {}, classNames: [] })
    expect(styleProps(fieldResolved)).toEqual({ style: {}, className: '' })
  })
})
