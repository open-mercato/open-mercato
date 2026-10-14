/**
 * Forms custom-styling vocabulary (`x-om-theme`, `OmSection.style`, `x-om-style`).
 *
 * Styling is end-user *data*, never CSS (security keystone — see
 * `.ai/specs/2026-05-22-forms-custom-styling.md` D1/D3/R-CS-1). The persisted
 * vocabulary is a small typed object of enums, integers, and **hex-only** color
 * strings; there is no member anywhere that accepts a raw CSS declaration,
 * selector, `url()`, `var()`, `calc()`, `expression()`, or free text. A pure
 * `style-compiler` (later task) turns a validated style object into a bounded
 * set of scoped CSS custom properties that remap the existing DS tokens.
 *
 * The enum sets exported here are the single source of truth consumed by
 * `style-validators.ts` (membership checks) and, later, the compiler.
 */

// ============================================================================
// Colors (D3)
// ============================================================================

/** Curated DS-role token — resolves to an existing DS var at compile time. */
export type OmColorToken =
  | 'surface'
  | 'surface-muted'
  | 'foreground'
  | 'muted-foreground'
  | 'accent'
  | 'border'
  | 'transparent'
  | 'inherit'

/** A color: a curated role token OR a strict hex literal. Nothing else (D3). */
export type OmColor = OmColorToken | `#${string}`

/** Strict hex literal — `#rgb`, `#rrggbb`, or `#rrggbbaa`. No other syntax. */
export const OM_HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Single source of truth for the curated color tokens. */
export const OM_COLOR_TOKENS: ReadonlySet<OmColorToken> = new Set<OmColorToken>([
  'surface',
  'surface-muted',
  'foreground',
  'muted-foreground',
  'accent',
  'border',
  'transparent',
  'inherit',
])

// ============================================================================
// Scales / families / weights / alignment
// ============================================================================

export type OmSpaceScale = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type OmRadiusScale = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type OmBorderScale = 'none' | 'subtle' | 'strong'
export type OmFontFamily = 'system' | 'sans' | 'serif' | 'mono' | 'rounded'
export type OmFontScale = 'sm' | 'md' | 'lg'
export type OmTextWeight = 'normal' | 'medium' | 'semibold' | 'bold'
export type OmContentWidth = 'sm' | 'md' | 'lg' | 'full'
export type OmTextAlign = 'start' | 'center' | 'end'

export const OM_SPACE_SCALE: ReadonlySet<OmSpaceScale> = new Set<OmSpaceScale>([
  'none',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
])

export const OM_RADIUS_SCALE: ReadonlySet<OmRadiusScale> = new Set<OmRadiusScale>([
  'none',
  'sm',
  'md',
  'lg',
  'full',
])

export const OM_BORDER_SCALE: ReadonlySet<OmBorderScale> = new Set<OmBorderScale>([
  'none',
  'subtle',
  'strong',
])

export const OM_FONT_FAMILY: ReadonlySet<OmFontFamily> = new Set<OmFontFamily>([
  'system',
  'sans',
  'serif',
  'mono',
  'rounded',
])

export const OM_FONT_SCALE: ReadonlySet<OmFontScale> = new Set<OmFontScale>(['sm', 'md', 'lg'])

export const OM_TEXT_WEIGHT: ReadonlySet<OmTextWeight> = new Set<OmTextWeight>([
  'normal',
  'medium',
  'semibold',
  'bold',
])

export const OM_CONTENT_WIDTH: ReadonlySet<OmContentWidth> = new Set<OmContentWidth>([
  'sm',
  'md',
  'lg',
  'full',
])

export const OM_TEXT_ALIGN: ReadonlySet<OmTextAlign> = new Set<OmTextAlign>([
  'start',
  'center',
  'end',
])

// ============================================================================
// Background (D6 — color + gradient in v1; image is Phase 2)
// ============================================================================

export type OmBackgroundKind = 'none' | 'color' | 'gradient'

export const OM_BACKGROUND_KINDS: ReadonlySet<OmBackgroundKind> = new Set<OmBackgroundKind>([
  'none',
  'color',
  'gradient',
])

export type OmBackground =
  | { kind: 'none' }
  | { kind: 'color'; color: OmColor }
  | { kind: 'gradient'; from: OmColor; to: OmColor; angle: number }
// Phase 2:
// | { kind: 'image'; assetId: string; fit?: 'cover' | 'contain'; overlay?: OmColor }

// ============================================================================
// Three style levels (D4) — root theme, section style, field style
// ============================================================================

/**
 * Logo / header image (Phase 2 of the styling spec). The author NEVER supplies a
 * URL — only `assetId`, the id of an image uploaded through the forms logo route
 * into the public attachments partition (no SSRF, no author-controlled fetch).
 * The render seam resolves it to the public image route by id.
 */
export type OmLogoSize = 'sm' | 'md' | 'lg'

export const OM_LOGO_SIZE: ReadonlySet<OmLogoSize> = new Set<OmLogoSize>(['sm', 'md', 'lg'])

export type OmThemeLogo = {
  assetId: string
  alt?: string
  align?: OmTextAlign
  size?: OmLogoSize
}

/** Root — `x-om-theme`. */
export type OmTheme = {
  background?: OmBackground
  surface?: OmColor
  /** Body text color (remaps `--foreground`) — general copy, helper text, etc. */
  foreground?: OmColor
  /** Form-wide input/textarea/select text color, distinct from body (field `x-om-style.textColor` overrides). */
  inputText?: OmColor
  /** Form-wide field-label color, distinct from body text (field `x-om-style.labelColor` overrides). */
  labelColor?: OmColor
  /** Form-wide field-label weight (field `x-om-style.labelWeight` overrides). */
  labelWeight?: OmTextWeight
  accent?: OmColor
  border?: OmColor
  fontFamily?: OmFontFamily
  fontScale?: OmFontScale
  radius?: OmRadiusScale
  contentWidth?: OmContentWidth
  logo?: OmThemeLogo
}

/** Section — `OmSection.style`. */
export type OmSectionStyle = {
  background?: OmBackground
  foreground?: OmColor
  padding?: OmSpaceScale
  border?: OmBorderScale
  radius?: OmRadiusScale
  card?: boolean
  align?: OmTextAlign
}

/** Field — `x-om-style`. */
export type OmFieldStyle = {
  labelWeight?: OmTextWeight
  labelColor?: OmColor
  textColor?: OmColor
  accent?: OmColor
  align?: OmTextAlign
}
