/**
 * Pure WCAG contrast helpers for the studio color controls (spec R-CS-4).
 *
 * Only ever fed strict hex literals (`#rgb`, `#rrggbb`, `#rrggbbaa`) — the
 * curated DS-role tokens are always considered contrast-safe and skip this
 * path. No I/O, no DOM, no `any`. Used to surface a non-blocking AA warning
 * when an author pairs a custom foreground/background below 4.5:1.
 */

import { OM_HEX_COLOR, type OmColor } from '../../../../../schema/style-extensions'

type Rgb = { r: number; g: number; b: number }

/**
 * Light-mode sRGB values of the curated DS-role tokens (the `:root` neutral
 * scale in `apps/mercato/src/app/globals.css`). Used so the AA check can compare
 * a custom hex against a token (the common branded case — e.g. custom text on
 * the default surface). `transparent` / `inherit` have no concrete color, so
 * they are intentionally absent and skip the check.
 */
const TOKEN_LIGHT_HEX: Partial<Record<OmColor, string>> = {
  surface: '#ffffff',
  'surface-muted': '#f5f5f5',
  foreground: '#0a0a0a',
  'muted-foreground': '#737373',
  accent: '#171717',
  border: '#e5e5e5',
}

function expandShortHex(hex: string): string {
  if (hex.length === 4) {
    const r = hex[1]
    const g = hex[2]
    const b = hex[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return hex
}

/** Parses a strict hex literal into 0–255 channels, or `null` when malformed. */
export function parseHex(value: string): Rgb | null {
  if (!OM_HEX_COLOR.test(value)) return null
  const expanded = expandShortHex(value)
  const r = Number.parseInt(expanded.slice(1, 3), 16)
  const g = Number.parseInt(expanded.slice(3, 5), 16)
  const b = Number.parseInt(expanded.slice(5, 7), 16)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return { r, g, b }
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/**
 * WCAG 2.x contrast ratio between two hex colors (1..21). Returns `null` when
 * either value is not a parseable hex literal (callers skip the check for
 * tokens / absent colors).
 */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = parseHex(hexA)
  const b = parseHex(hexB)
  if (!a || !b) return null
  const lumA = relativeLuminance(a)
  const lumB = relativeLuminance(b)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA threshold for normal-size body text. */
export const AA_CONTRAST_RATIO = 4.5

export function meetsAA(ratio: number): boolean {
  return ratio >= AA_CONTRAST_RATIO
}

/**
 * Resolve any `OmColor` (hex literal OR curated token) to sRGB for the AA check.
 * Tokens map to their light-mode DS value; `transparent`/`inherit` (no concrete
 * color) and malformed input return `null` so the caller skips the comparison.
 */
export function resolveColorToRgb(color: OmColor | undefined): Rgb | null {
  if (typeof color !== 'string' || color.length === 0) return null
  if (OM_HEX_COLOR.test(color)) return parseHex(color)
  const tokenHex = TOKEN_LIGHT_HEX[color]
  return tokenHex ? parseHex(tokenHex) : null
}

/**
 * AA contrast between two `OmColor`s when at least one side is a CUSTOM hex.
 * Token-vs-token pairs are DS-curated (always AA-safe) and return `null` to
 * avoid false positives. Returns the ratio when below AA (a warning is due),
 * or `null` when safe / not comparable.
 */
export function belowAaForPair(a: OmColor | undefined, b: OmColor | undefined): number | null {
  const aIsHex = typeof a === 'string' && OM_HEX_COLOR.test(a)
  const bIsHex = typeof b === 'string' && OM_HEX_COLOR.test(b)
  if (!aIsHex && !bIsHex) return null
  const rgbA = resolveColorToRgb(a)
  const rgbB = resolveColorToRgb(b)
  if (!rgbA || !rgbB) return null
  const lighter = Math.max(relativeLuminance(rgbA), relativeLuminance(rgbB))
  const darker = Math.min(relativeLuminance(rgbA), relativeLuminance(rgbB))
  const ratio = (lighter + 0.05) / (darker + 0.05)
  return meetsAA(ratio) ? null : ratio
}
