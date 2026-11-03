/**
 * Pure style compiler for the forms custom-styling vocabulary
 * (`x-om-theme`, `OmSection.style`, `x-om-style`).
 *
 * This module is the security keystone's apply seam (see
 * `.ai/specs/2026-05-22-forms-custom-styling.md` D1/D2/D3/R-CS-1): it is the
 * ONLY place a validated style object becomes CSS. It is pure — no I/O, no DI,
 * no React — and returns plain data consumed later as a React `style` object
 * (React escapes values; we never build a `<style>` string or use
 * `dangerouslySetInnerHTML`).
 *
 * Output guarantees (R-CS-1): every emitted `cssVars` value is one of —
 *  - a hex literal RE-VALIDATED against `OM_HEX_COLOR`,
 *  - a known `var(--…)` reference from the fixed allowlist,
 *  - a `linear-gradient(<int>deg, <hex>, <hex>)` built from a fixed template
 *    with both stops re-validated as hex and the angle clamped to `[0, 360]`,
 *  - an allowlisted font-family stack,
 *  - `'transparent'` / `'inherit'`,
 *  - a fixed rem/px radius literal.
 * Any value that fails its check is OMITTED (defensive — never emit an
 * unchecked string). `classNames` come ONLY from fixed enum→class maps; user
 * input is never interpolated into a class name.
 */

import {
  OM_HEX_COLOR,
  type OmBackground,
  type OmColor,
  type OmColorToken,
  type OmContentWidth,
  type OmFieldStyle,
  type OmFontFamily,
  type OmFontScale,
  type OmRadiusScale,
  type OmSectionStyle,
  type OmSpaceScale,
  type OmTextAlign,
  type OmTextWeight,
  type OmTheme,
} from '../schema/style-extensions'

export type ResolvedStyle = {
  /** Custom-property + safe direct CSS-prop map, applied as a React style object. */
  cssVars: Record<string, string>
  /** DS utility class names (font scale, content width, padding, border, card, align, weight). */
  classNames: string[]
}

const EMPTY_STYLE: ResolvedStyle = { cssVars: {}, classNames: [] }

// ============================================================================
// Fixed value maps (no interpolation of user input)
// ============================================================================

const COLOR_TOKEN_TO_VAR: Record<OmColorToken, string> = {
  surface: 'var(--card)',
  'surface-muted': 'var(--muted)',
  foreground: 'var(--foreground)',
  'muted-foreground': 'var(--muted-foreground)',
  accent: 'var(--primary)',
  border: 'var(--border)',
  transparent: 'transparent',
  inherit: 'inherit',
}

const RADIUS_SCALE_TO_LITERAL: Record<OmRadiusScale, string> = {
  none: '0px',
  sm: '0.375rem',
  md: '0.625rem',
  lg: '0.875rem',
  full: '9999px',
}

const FONT_FAMILY_TO_STACK: Record<OmFontFamily, string> = {
  system: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
}

const FONT_SCALE_TO_CLASS: Record<OmFontScale, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}

const CONTENT_WIDTH_TO_CLASS: Record<OmContentWidth, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  full: 'max-w-none',
}

const PADDING_SCALE_TO_CLASS: Record<OmSpaceScale, string> = {
  none: 'p-0',
  xs: 'p-2',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  xl: 'p-8',
}

const SECTION_BORDER_TO_CLASS: Record<'none' | 'subtle' | 'strong', string> = {
  none: 'border-0',
  subtle: 'border border-border',
  strong: 'border-2 border-border',
}

const SECTION_RADIUS_TO_CLASS: Record<OmRadiusScale, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
}

const ALIGN_TO_CLASS: Record<OmTextAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
}

const LABEL_WEIGHT_TO_CLASS: Record<OmTextWeight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
}

/** Numeric font-weights bound to `--om-label-weight` (form + field label styling). */
const LABEL_WEIGHT_TO_NUMBER: Record<OmTextWeight, string> = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
}

const CARD_CLASSES: readonly string[] = ['bg-card', 'shadow-sm', 'border', 'border-border', 'rounded-lg']

// ============================================================================
// Defensive resolvers (re-validate every value before it becomes CSS)
// ============================================================================

/**
 * Resolve a color into a safe CSS value: an allowlisted `var(--…)` /
 * `transparent` / `inherit` for a curated token, or a re-validated hex literal.
 * Returns `null` for anything else so the caller omits the property.
 */
function resolveColor(color: OmColor | undefined): string | null {
  if (typeof color !== 'string' || color.length === 0) return null
  if (color in COLOR_TOKEN_TO_VAR) {
    return COLOR_TOKEN_TO_VAR[color as OmColorToken]
  }
  if (OM_HEX_COLOR.test(color)) {
    return color
  }
  return null
}

function clampAngle(angle: number): number | null {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return null
  const rounded = Math.round(angle)
  if (rounded < 0) return 0
  if (rounded > 360) return 360
  return rounded
}

/**
 * Build a `linear-gradient(<deg>deg, <hex>, <hex>)` from the fixed template.
 * Both stops MUST be hex literals (re-validated) and the angle is clamped to
 * `[0, 360]`. Returns `null` if either stop is not a strict hex literal.
 */
function resolveGradient(from: OmColor, to: OmColor, angle: number): string | null {
  if (typeof from !== 'string' || !OM_HEX_COLOR.test(from)) return null
  if (typeof to !== 'string' || !OM_HEX_COLOR.test(to)) return null
  const safeAngle = clampAngle(angle)
  if (safeAngle === null) return null
  return `linear-gradient(${safeAngle}deg, ${from}, ${to})`
}

// ============================================================================
// Background application
// ============================================================================

type BackgroundApply = {
  /** A solid color value (var/hex/transparent/inherit) when kind === 'color'. */
  color?: string
  /** A gradient value when kind === 'gradient'. */
  gradient?: string
}

function applyBackground(background: OmBackground | undefined): BackgroundApply {
  if (!background || typeof background !== 'object') return {}
  if (background.kind === 'color') {
    const color = resolveColor(background.color)
    if (color === null) return {}
    return { color }
  }
  if (background.kind === 'gradient') {
    const gradient = resolveGradient(background.from, background.to, background.angle)
    if (gradient === null) return {}
    return { gradient }
  }
  return {}
}

// ============================================================================
// compileFormTheme — sets DS-token custom props on the `.om-form-theme` scope
// ============================================================================

export function compileFormTheme(theme: OmTheme | undefined | null): ResolvedStyle {
  if (!theme || typeof theme !== 'object') return { cssVars: {}, classNames: [] }

  const cssVars: Record<string, string> = {}
  const classNames: string[] = []

  const surface = resolveColor(theme.surface)
  if (surface !== null) cssVars['--card'] = surface

  const foreground = resolveColor(theme.foreground)
  if (foreground !== null) cssVars['--foreground'] = foreground

  // Form-wide input/textarea/select text — bound on the form scope; the rule
  // `.om-form-theme :is(input, textarea, select) { color: var(--om-text-color,
  // var(--foreground)) }` (globals.css) picks it up. A field's `x-om-style`
  // sets the same var on its own wrapper and overrides by var proximity.
  const inputText = resolveColor(theme.inputText)
  if (inputText !== null) cssVars['--om-text-color'] = inputText

  // Form-wide label styling — bound to labels via the `om-form-label-*` marker
  // classes (globals.css). A field's `x-om-style` sets the same `--om-label-*`
  // vars on its own wrapper, so per-field label styling overrides by proximity.
  const labelColor = resolveColor(theme.labelColor)
  if (labelColor !== null) {
    cssVars['--om-label-color'] = labelColor
    classNames.push('om-form-label-color')
  }
  if (theme.labelWeight && theme.labelWeight in LABEL_WEIGHT_TO_NUMBER) {
    cssVars['--om-label-weight'] = LABEL_WEIGHT_TO_NUMBER[theme.labelWeight]
    classNames.push('om-form-label-weight')
  }

  const accent = resolveColor(theme.accent)
  if (accent !== null) {
    cssVars['--primary'] = accent
    cssVars['--ring'] = accent
  }

  const border = resolveColor(theme.border)
  if (border !== null) {
    cssVars['--border'] = border
    cssVars['--input'] = border
  }

  if (theme.radius && theme.radius in RADIUS_SCALE_TO_LITERAL) {
    cssVars['--radius'] = RADIUS_SCALE_TO_LITERAL[theme.radius]
  }

  const background = applyBackground(theme.background)
  if (background.color !== undefined) {
    cssVars['--background'] = background.color
    cssVars['background'] = background.color
  } else if (background.gradient !== undefined) {
    cssVars['backgroundImage'] = background.gradient
  }

  if (theme.fontFamily && theme.fontFamily in FONT_FAMILY_TO_STACK) {
    cssVars['fontFamily'] = FONT_FAMILY_TO_STACK[theme.fontFamily]
  }

  if (theme.fontScale && theme.fontScale in FONT_SCALE_TO_CLASS) {
    classNames.push(FONT_SCALE_TO_CLASS[theme.fontScale])
  }

  if (theme.contentWidth && theme.contentWidth in CONTENT_WIDTH_TO_CLASS) {
    classNames.push(CONTENT_WIDTH_TO_CLASS[theme.contentWidth])
  }

  if (Object.keys(cssVars).length === 0 && classNames.length === 0) return EMPTY_STYLE
  return { cssVars, classNames }
}

// ============================================================================
// compileSectionStyle — section wrapper
// ============================================================================

export function compileSectionStyle(style: OmSectionStyle | undefined | null): ResolvedStyle {
  if (!style || typeof style !== 'object') return { cssVars: {}, classNames: [] }

  const cssVars: Record<string, string> = {}
  const classNames: string[] = []

  const background = applyBackground(style.background)
  if (background.color !== undefined) {
    cssVars['background'] = background.color
  } else if (background.gradient !== undefined) {
    cssVars['backgroundImage'] = background.gradient
  }

  const foreground = resolveColor(style.foreground)
  if (foreground !== null) {
    cssVars['color'] = foreground
    cssVars['--foreground'] = foreground
  }

  if (style.padding && style.padding in PADDING_SCALE_TO_CLASS) {
    classNames.push(PADDING_SCALE_TO_CLASS[style.padding])
  }

  if (style.border && style.border in SECTION_BORDER_TO_CLASS) {
    classNames.push(SECTION_BORDER_TO_CLASS[style.border])
  }

  if (style.radius && style.radius in SECTION_RADIUS_TO_CLASS) {
    classNames.push(SECTION_RADIUS_TO_CLASS[style.radius])
  }

  if (style.card === true) {
    classNames.push(...CARD_CLASSES)
  }

  if (style.align && style.align in ALIGN_TO_CLASS) {
    classNames.push(ALIGN_TO_CLASS[style.align])
  }

  if (Object.keys(cssVars).length === 0 && classNames.length === 0) return EMPTY_STYLE
  return { cssVars, classNames }
}

// ============================================================================
// compileFieldStyle — field wrapper
// ============================================================================

export function compileFieldStyle(style: OmFieldStyle | undefined | null): ResolvedStyle {
  if (!style || typeof style !== 'object') return { cssVars: {}, classNames: [] }

  const cssVars: Record<string, string> = {}
  const classNames: string[] = []

  // Label weight: keep the wrapper font class AND set the `--om-label-weight`
  // var so a per-field weight overrides a form-wide label weight by proximity
  // (the form's `om-form-label-weight` rule reads the nearest var value).
  if (style.labelWeight && style.labelWeight in LABEL_WEIGHT_TO_CLASS) {
    classNames.push(LABEL_WEIGHT_TO_CLASS[style.labelWeight])
    cssVars['--om-label-weight'] = LABEL_WEIGHT_TO_NUMBER[style.labelWeight]
  }

  // Color vars are paired with a marker class so the scoped stylesheet
  // (`ui/public/style/forms-theme.css`) can bind them to a real `color` on the
  // label / inputs. Without the class the var is inert (the original bug). The
  // class is pushed ONLY when a color is set, so an unstyled field stays
  // byte-identical (R-CS-6).
  const labelColor = resolveColor(style.labelColor)
  if (labelColor !== null) {
    cssVars['--om-label-color'] = labelColor
    classNames.push('om-field-label-color')
  }

  const textColor = resolveColor(style.textColor)
  if (textColor !== null) {
    cssVars['--om-text-color'] = textColor
    classNames.push('om-field-text-color')
  }

  const accent = resolveColor(style.accent)
  if (accent !== null) {
    cssVars['--om-field-accent'] = accent
    cssVars['accentColor'] = accent
  }

  if (style.align && style.align in ALIGN_TO_CLASS) {
    classNames.push(ALIGN_TO_CLASS[style.align])
  }

  if (Object.keys(cssVars).length === 0 && classNames.length === 0) return EMPTY_STYLE
  return { cssVars, classNames }
}
