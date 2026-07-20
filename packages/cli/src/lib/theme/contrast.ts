/**
 * WCAG 2.1 contrast math for `mercato theme init`.
 *
 * Dependency-free, normative implementation per WCAG 2.1:
 * - Channel linearization: c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
 * - Relative luminance: L = 0.2126 R + 0.7152 G + 0.0722 B
 * - Contrast ratio: (L1 + 0.05) / (L2 + 0.05) with L1 the lighter color
 */

export type Rgb = {
  /** Red channel, 0-255 */
  r: number
  /** Green channel, 0-255 */
  g: number
  /** Blue channel, 0-255 */
  b: number
}

/** AA threshold for normal text (4.5:1). */
export const WCAG_AA_TEXT = 4.5
/** AA threshold for non-text UI components (3:1). */
export const WCAG_AA_UI = 3

/**
 * Parses `#RGB` or `#RRGGBB` hex colors (case-insensitive).
 * Returns null for anything else.
 */
export function parseHexColor(input: string): Rgb | null {
  const value = input.trim()
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(value)
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('')
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
    }
  }
  const longMatch = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (longMatch) {
    return {
      r: Number.parseInt(longMatch[1].slice(0, 2), 16),
      g: Number.parseInt(longMatch[1].slice(2, 4), 16),
      b: Number.parseInt(longMatch[1].slice(4, 6), 16),
    }
  }
  return null
}

/** Formats an Rgb triple back to lowercase `#rrggbb`. */
export function formatHexColor(rgb: Rgb): string {
  const channel = (value: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)))
    return clamped.toString(16).padStart(2, '0')
  }
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`
}

function linearizeChannel(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG 2.1 relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearizeChannel(rgb.r) +
    0.7152 * linearizeChannel(rgb.g) +
    0.0722 * linearizeChannel(rgb.b)
  )
}

/** WCAG 2.1 contrast ratio between two colors, in [1, 21]. Symmetric. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Formats a contrast ratio for CLI output, e.g. `4.5:1` or `12.1:1`. */
export function formatContrastRatio(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}:1`
}
