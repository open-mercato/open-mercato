/**
 * OKLCH palette derivation for `mercato theme init`.
 *
 * All derivation happens in OKLCH (perceptually uniform lightness — matches how
 * `globals.css` expresses themed tokens), using Björn Ottosson's reference OKLab
 * math. Dependency-free; emitted values are plain sRGB hex so adopters can edit
 * the generated `theme.css` by hand.
 */

import {
  contrastRatio,
  formatHexColor,
  parseHexColor,
  type Rgb,
  WCAG_AA_TEXT,
  WCAG_AA_UI,
} from './contrast'

export type Oklch = {
  /** Perceptual lightness, 0-1 */
  l: number
  /** Chroma, >= 0 */
  c: number
  /** Hue in degrees, [0, 360) — meaningless when c is 0 */
  h: number
}

const FOREGROUND_LIGHT_CANDIDATE = '#ffffff'
const FOREGROUND_DARK_CANDIDATE = '#0a0a0a'

/** Dark-mode `--primary` lightness floor — mirrors `--brand-violet` 0.55 → 0.65. */
const DARK_PRIMARY_MIN_LIGHTNESS = 0.65
/** Hover derivation: lightness delta, mirroring the default theme's 0.205 → 0.145. */
const HOVER_LIGHTNESS_DELTA = 0.06
/** Hover lightness clamp floor. */
const HOVER_MIN_LIGHTNESS = 0.1

// ── sRGB <-> OKLCH (reference implementation, no dependencies) ──────────────

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  return c * 255
}

function rgbToOklch(rgb: Rgb): Oklch {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const chroma = Math.sqrt(okA * okA + okB * okB)
  let hue = (Math.atan2(okB, okA) * 180) / Math.PI
  if (hue < 0) hue += 360
  return { l: okL, c: chroma, h: hue }
}

function oklchToLinearRgb({ l, c, h }: Oklch): { r: number; g: number; b: number } {
  const hRad = (h * Math.PI) / 180
  const okA = c * Math.cos(hRad)
  const okB = c * Math.sin(hRad)

  const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB
  const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB
  const s_ = l - 0.0894841775 * okA - 1.291485548 * okB

  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  }
}

function isInGamut(linear: { r: number; g: number; b: number }): boolean {
  const epsilon = 1e-6
  return (
    linear.r >= -epsilon && linear.r <= 1 + epsilon &&
    linear.g >= -epsilon && linear.g <= 1 + epsilon &&
    linear.b >= -epsilon && linear.b <= 1 + epsilon
  )
}

/**
 * Converts OKLCH back to sRGB, gamut-mapping by chroma reduction (binary
 * search) so lightness and hue are preserved when a derived color falls
 * outside sRGB. Deterministic.
 */
export function oklchToRgb(color: Oklch): Rgb {
  let target = color
  if (!isInGamut(oklchToLinearRgb(target))) {
    let low = 0
    let high = color.c
    for (let i = 0; i < 32; i += 1) {
      const mid = (low + high) / 2
      if (isInGamut(oklchToLinearRgb({ ...color, c: mid }))) {
        low = mid
      } else {
        high = mid
      }
    }
    target = { ...color, c: low }
  }
  const linear = oklchToLinearRgb(target)
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
  return {
    r: linearToSrgb(clamp01(linear.r)),
    g: linearToSrgb(clamp01(linear.g)),
    b: linearToSrgb(clamp01(linear.b)),
  }
}

/** Parses a hex color into OKLCH. Returns null when the hex is invalid. */
export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHexColor(hex)
  if (!rgb) return null
  return rgbToOklch(rgb)
}

/** Converts OKLCH to a lowercase `#rrggbb` string (gamut-mapped). */
export function oklchToHex(color: Oklch): string {
  return formatHexColor(oklchToRgb(color))
}

// ── Palette derivation ──────────────────────────────────────────────────────

export type ForegroundPick = {
  hex: string
  ratio: number
  autoPicked: boolean
}

export type ModePalette = {
  primary: string
  primaryHover: string
  primaryForeground: ForegroundPick
}

export type DerivedPalette = {
  light: ModePalette
  dark: ModePalette
}

function pickForeground(primaryHex: string): ForegroundPick {
  const primary = parseHexColor(primaryHex)
  if (!primary) throw new Error(`Invalid primary color: ${primaryHex}`)
  const light = parseHexColor(FOREGROUND_LIGHT_CANDIDATE) as Rgb
  const dark = parseHexColor(FOREGROUND_DARK_CANDIDATE) as Rgb
  const lightRatio = contrastRatio(light, primary)
  const darkRatio = contrastRatio(dark, primary)
  return lightRatio >= darkRatio
    ? { hex: FOREGROUND_LIGHT_CANDIDATE, ratio: lightRatio, autoPicked: true }
    : { hex: FOREGROUND_DARK_CANDIDATE, ratio: darkRatio, autoPicked: true }
}

function resolveForeground(primaryHex: string, explicitHex: string | null): ForegroundPick {
  if (explicitHex) {
    const primary = parseHexColor(primaryHex)
    const foreground = parseHexColor(explicitHex)
    if (!primary) throw new Error(`Invalid primary color: ${primaryHex}`)
    if (!foreground) throw new Error(`Invalid foreground color: ${explicitHex}`)
    return { hex: explicitHex.toLowerCase(), ratio: contrastRatio(foreground, primary), autoPicked: false }
  }
  return pickForeground(primaryHex)
}

function deriveHover(primary: Oklch): string {
  return oklchToHex({
    ...primary,
    l: Math.max(HOVER_MIN_LIGHTNESS, primary.l - HOVER_LIGHTNESS_DELTA),
  })
}

/**
 * Derives the full light + dark palette from one brand primary.
 *
 * - Light `--primary` is the input, emitted as provided (lowercased).
 * - Hover: lightness − 0.06 (clamped >= 0.10), hue/chroma preserved.
 * - Foreground: white/near-black auto-pick by contrast unless supplied.
 * - Dark `--primary`: input with lightness raised to >= 0.65; hover and
 *   foreground re-derived and re-validated independently against it.
 */
export function derivePalette(options: {
  primaryHex: string
  primaryForegroundHex?: string | null
}): DerivedPalette {
  // `--primary` is the input color, emitted as provided (trimmed only).
  const primaryInput = options.primaryHex.trim()
  const primaryOklch = hexToOklch(primaryInput)
  if (!primaryOklch) {
    throw new Error(`Invalid primary color: ${options.primaryHex}. Expected #RGB or #RRGGBB.`)
  }
  const explicitForeground = options.primaryForegroundHex?.trim().toLowerCase() ?? null

  const lightPrimaryHex = primaryInput
  const light: ModePalette = {
    primary: lightPrimaryHex,
    primaryHover: deriveHover(primaryOklch),
    primaryForeground: resolveForeground(lightPrimaryHex, explicitForeground),
  }

  const darkPrimaryOklch: Oklch = {
    ...primaryOklch,
    l: Math.max(primaryOklch.l, DARK_PRIMARY_MIN_LIGHTNESS),
  }
  const darkPrimaryHex = oklchToHex(darkPrimaryOklch)
  const dark: ModePalette = {
    primary: darkPrimaryHex,
    primaryHover: deriveHover(hexToOklch(darkPrimaryHex) as Oklch),
    // Explicit foreground applies to light mode only; dark is re-picked and
    // re-validated independently against the (lighter) dark primary.
    primaryForeground: resolveForeground(darkPrimaryHex, null),
  }

  return { light, dark }
}

// ── Radius / font validation ────────────────────────────────────────────────

export type RadiusValidation = {
  value: string
  warnings: string[]
  valid: boolean
}

const CSS_LENGTH_PATTERN = /^(\d*\.?\d+)(px|rem|em)$/

/**
 * Validates a `--radius` value: must parse as a CSS length. Warns below
 * 0.25rem (4px) because `--radius-sm: calc(var(--radius) - 4px)` clamps to
 * zero or negative, and above 1rem where component geometry degrades.
 */
export function validateRadius(input: string): RadiusValidation {
  const value = input.trim()
  const match = CSS_LENGTH_PATTERN.exec(value)
  if (!match && value !== '0') {
    return { value, valid: false, warnings: [] }
  }
  const amount = value === '0' ? 0 : Number.parseFloat(match![1])
  const unit = value === '0' ? 'px' : match![2]
  const px = unit === 'px' ? amount : amount * 16
  const warnings: string[] = []
  if (px < 4) {
    warnings.push(
      `--radius ${value} is below 0.25rem: the derived --radius-sm (calc(var(--radius) - 4px)) clamps to zero or negative.`,
    )
  } else if (px > 16) {
    warnings.push(
      `--radius ${value} is above 1rem: large radii can clip compact controls (checkboxes, small buttons).`,
    )
  }
  return { value, valid: true, warnings }
}

// ── theme.css emission ──────────────────────────────────────────────────────

/** System UI stack appended as fallback when `--font` overrides the family. */
export const SYSTEM_FONT_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/** Tokens `theme init` can emit — the safe identity surface, nothing else. */
export const SAFE_TOKENS = [
  '--primary',
  '--primary-hover',
  '--primary-foreground',
  '--brand-lime',
  '--brand-violet',
  '--brand-violet-foreground',
  '--radius',
  '--font-geist-sans',
  '--font-geist-mono',
] as const

/** Protected token prefixes that must never appear in a generated theme. */
export const PROTECTED_TOKEN_PATTERNS = [
  '--status-',
  '--accent-indigo',
  '--z-index-',
  '--shadow-focus',
] as const

export type ThemeCssOptions = {
  palette: DerivedPalette
  radius?: string | null
  fontFamily?: string | null
}

const THEME_HEADER = `/* theme.css — YOUR brand overrides. This file is yours: framework upgrades
 * never touch it. It MUST stay imported after globals.css (source order is
 * what makes these overrides win). Regenerate with:
 *   yarn mercato theme init --primary "<hex>" --force
 * Safe tokens: --primary, --primary-hover, --primary-foreground,
 * --brand-lime, --brand-violet(-foreground), --radius, --font-geist-sans/mono.
 * Never override --status-*, --accent-indigo, --z-index-*, --shadow-focus.
 * Full contract: https://docs.open-mercato.dev/customization/brand-your-app */`

/**
 * Renders the generated `theme.css`. Pure and deterministic: the same options
 * always produce byte-identical output.
 */
export function renderThemeCss(options: ThemeCssOptions): string {
  const { palette, radius, fontFamily } = options
  const rootLines: string[] = [
    `  --primary: ${palette.light.primary};`,
    `  --primary-hover: ${palette.light.primaryHover};`,
    `  --primary-foreground: ${palette.light.primaryForeground.hex};`,
  ]
  if (radius) rootLines.push(`  --radius: ${radius};`)
  if (fontFamily) {
    const family = /[\s"']/.test(fontFamily) && !fontFamily.startsWith('"')
      ? `"${fontFamily}"`
      : fontFamily
    rootLines.push(
      '  /* Token override only — remember to actually load the font',
      '   * (next/font in layout.tsx, or @font-face here). */',
      `  --font-geist-sans: ${family}, ${SYSTEM_FONT_FALLBACK};`,
    )
  }

  const darkLines: string[] = [
    `  --primary: ${palette.dark.primary};`,
    `  --primary-hover: ${palette.dark.primaryHover};`,
    `  --primary-foreground: ${palette.dark.primaryForeground.hex};`,
  ]

  return [
    THEME_HEADER,
    '',
    ':root {',
    ...rootLines,
    '}',
    '',
    '/* Dark mode — derived defaults (dark primary is a lighter tint of your brand',
    ' * color, mirroring the framework theme). Tune these by hand if the derived',
    ' * hue drifts off-brand. */',
    '.dark {',
    ...darkLines,
    '}',
    '',
  ].join('\n')
}
