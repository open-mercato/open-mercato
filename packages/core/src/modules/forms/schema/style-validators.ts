/**
 * Strict validators for the forms custom-styling vocabulary
 * (`x-om-theme`, `OmSection.style`, `x-om-style`).
 *
 * Each validator returns the first violation message (a string) or `null` when
 * the value is valid — mirroring the existing `OM_ROOT_VALIDATORS` /
 * `OM_FIELD_VALIDATORS` contract in `jsonschema-extensions.ts`.
 *
 * Security keystone (D1/D3/R-CS-1): there is no value an author can persist
 * that becomes an executable/parsed CSS declaration or selector. Colors are
 * either a curated token or a strict hex literal — no `rgb()`, `hsl()`, named
 * colors, `url()`, `var()`, `expression()`, or functional syntax. Every object
 * rejects unknown keys (strict — no passthrough). All validators are pure (no
 * I/O) and narrow `unknown` without `any`.
 */

import {
  OM_BACKGROUND_KINDS,
  OM_BORDER_SCALE,
  OM_COLOR_TOKENS,
  OM_CONTENT_WIDTH,
  OM_FONT_FAMILY,
  OM_FONT_SCALE,
  OM_HEX_COLOR,
  OM_LOGO_SIZE,
  OM_RADIUS_SCALE,
  OM_SPACE_SCALE,
  OM_TEXT_ALIGN,
  OM_TEXT_WEIGHT,
} from './style-extensions'

/** Attachment ids are server-minted UUIDs — the only assetId shape we accept. */
const OM_ASSET_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const LOGO_KEYS: ReadonlySet<string> = new Set(['assetId', 'alt', 'align', 'size'])

type UnknownRecord = Record<string, unknown>

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKey(candidate: UnknownRecord, allowed: ReadonlySet<string>, scope: string): string | null {
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      return `${scope} has an unknown key "${key}".`
    }
  }
  return null
}

/**
 * A color is either a curated DS-role token OR a strict hex literal
 * (`#rgb`, `#rrggbb`, `#rrggbbaa`). Everything else — `rgb()`, `hsl()`, named
 * colors, `url()`, `var()`, `expression()`, any functional/parenthesised
 * syntax — is rejected (D3 / R-CS-1).
 */
export function validateOmColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return 'Color must be a curated token or a hex literal string.'
  }
  if (OM_COLOR_TOKENS.has(value as never)) return null
  if (OM_HEX_COLOR.test(value)) return null
  return 'Color must be a curated token or a strict hex literal (#rgb, #rrggbb, or #rrggbbaa) — no rgb()/hsl()/named/functional syntax.'
}

const BACKGROUND_KEYS_BY_KIND: Record<string, ReadonlySet<string>> = {
  none: new Set(['kind']),
  color: new Set(['kind', 'color']),
  gradient: new Set(['kind', 'from', 'to', 'angle']),
}

export function validateOmBackground(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Background must be an object with a `kind` discriminator.'
  }
  const kind = value.kind
  if (typeof kind !== 'string' || !OM_BACKGROUND_KINDS.has(kind as never)) {
    return 'Background `kind` must be "none", "color", or "gradient".'
  }
  const unknown = unknownKey(value, BACKGROUND_KEYS_BY_KIND[kind], `Background (kind "${kind}")`)
  if (unknown) return unknown

  if (kind === 'none') {
    return null
  }
  if (kind === 'color') {
    const colorMessage = validateOmColor(value.color)
    if (colorMessage) return `Background color: ${colorMessage}`
    return null
  }
  // gradient
  const fromMessage = validateOmColor(value.from)
  if (fromMessage) return `Background gradient from: ${fromMessage}`
  const toMessage = validateOmColor(value.to)
  if (toMessage) return `Background gradient to: ${toMessage}`
  const angle = value.angle
  if (typeof angle !== 'number' || !Number.isInteger(angle) || angle < 0 || angle > 360) {
    return 'Background gradient `angle` must be an integer in [0, 360].'
  }
  return null
}

function validateEnumMember(
  candidate: UnknownRecord,
  key: string,
  allowed: ReadonlySet<string>,
  label: string,
): string | null {
  if (candidate[key] === undefined) return null
  const member = candidate[key]
  if (typeof member !== 'string' || !allowed.has(member)) {
    return `${label} must be one of ${[...allowed].map((entry) => `"${entry}"`).join(', ')}.`
  }
  return null
}

function validateColorMember(candidate: UnknownRecord, key: string, label: string): string | null {
  if (candidate[key] === undefined) return null
  const message = validateOmColor(candidate[key])
  if (message) return `${label}: ${message}`
  return null
}

function validateBackgroundMember(candidate: UnknownRecord, key: string, label: string): string | null {
  if (candidate[key] === undefined) return null
  const message = validateOmBackground(candidate[key])
  if (message) return `${label}: ${message}`
  return null
}

const THEME_KEYS: ReadonlySet<string> = new Set([
  'background',
  'surface',
  'foreground',
  'inputText',
  'labelColor',
  'labelWeight',
  'accent',
  'border',
  'fontFamily',
  'fontScale',
  'radius',
  'contentWidth',
  'logo',
])

/**
 * `logo` carries only an attachment id + display hints — never a URL or raw
 * text that reaches the DOM unescaped. `assetId` must be a UUID (a server-minted
 * attachment id); `alt` is a bounded plain string; `align`/`size` are fixed
 * enums; unknown keys are rejected (D4 / R-CS-1).
 */
export function validateOmThemeLogo(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'x-om-theme.logo must be an object.'
  }
  const unknown = unknownKey(value, LOGO_KEYS, 'x-om-theme.logo')
  if (unknown) return unknown
  if (typeof value.assetId !== 'string' || !OM_ASSET_ID.test(value.assetId)) {
    return 'x-om-theme.logo.assetId must be an uploaded image id (UUID).'
  }
  if (value.alt !== undefined && (typeof value.alt !== 'string' || value.alt.length > 300)) {
    return 'x-om-theme.logo.alt must be a string of at most 300 characters.'
  }
  return (
    validateEnumMember(value, 'align', OM_TEXT_ALIGN, 'x-om-theme.logo.align')
    || validateEnumMember(value, 'size', OM_LOGO_SIZE, 'x-om-theme.logo.size')
  )
}

export function validateOmTheme(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'x-om-theme must be an object.'
  }
  const unknown = unknownKey(value, THEME_KEYS, 'x-om-theme')
  if (unknown) return unknown

  return (
    validateBackgroundMember(value, 'background', 'x-om-theme.background')
    || validateColorMember(value, 'surface', 'x-om-theme.surface')
    || validateColorMember(value, 'foreground', 'x-om-theme.foreground')
    || validateColorMember(value, 'inputText', 'x-om-theme.inputText')
    || validateColorMember(value, 'labelColor', 'x-om-theme.labelColor')
    || validateEnumMember(value, 'labelWeight', OM_TEXT_WEIGHT, 'x-om-theme.labelWeight')
    || validateColorMember(value, 'accent', 'x-om-theme.accent')
    || validateColorMember(value, 'border', 'x-om-theme.border')
    || validateEnumMember(value, 'fontFamily', OM_FONT_FAMILY, 'x-om-theme.fontFamily')
    || validateEnumMember(value, 'fontScale', OM_FONT_SCALE, 'x-om-theme.fontScale')
    || validateEnumMember(value, 'radius', OM_RADIUS_SCALE, 'x-om-theme.radius')
    || validateEnumMember(value, 'contentWidth', OM_CONTENT_WIDTH, 'x-om-theme.contentWidth')
    || (value.logo !== undefined ? validateOmThemeLogo(value.logo) : null)
  )
}

const SECTION_STYLE_KEYS: ReadonlySet<string> = new Set([
  'background',
  'foreground',
  'padding',
  'border',
  'radius',
  'card',
  'align',
])

export function validateOmSectionStyle(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Section `style` must be an object.'
  }
  const unknown = unknownKey(value, SECTION_STYLE_KEYS, 'Section `style`')
  if (unknown) return unknown

  const backgroundMessage = validateBackgroundMember(value, 'background', 'Section style.background')
  if (backgroundMessage) return backgroundMessage
  const foregroundMessage = validateColorMember(value, 'foreground', 'Section style.foreground')
  if (foregroundMessage) return foregroundMessage
  const paddingMessage = validateEnumMember(value, 'padding', OM_SPACE_SCALE, 'Section style.padding')
  if (paddingMessage) return paddingMessage
  const borderMessage = validateEnumMember(value, 'border', OM_BORDER_SCALE, 'Section style.border')
  if (borderMessage) return borderMessage
  const radiusMessage = validateEnumMember(value, 'radius', OM_RADIUS_SCALE, 'Section style.radius')
  if (radiusMessage) return radiusMessage
  if (value.card !== undefined && typeof value.card !== 'boolean') {
    return 'Section style.card must be a boolean when present.'
  }
  const alignMessage = validateEnumMember(value, 'align', OM_TEXT_ALIGN, 'Section style.align')
  if (alignMessage) return alignMessage
  return null
}

const FIELD_STYLE_KEYS: ReadonlySet<string> = new Set([
  'labelWeight',
  'labelColor',
  'textColor',
  'accent',
  'align',
])

export function validateOmFieldStyle(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'x-om-style must be an object.'
  }
  const unknown = unknownKey(value, FIELD_STYLE_KEYS, 'x-om-style')
  if (unknown) return unknown

  return (
    validateEnumMember(value, 'labelWeight', OM_TEXT_WEIGHT, 'x-om-style.labelWeight')
    || validateColorMember(value, 'labelColor', 'x-om-style.labelColor')
    || validateColorMember(value, 'textColor', 'x-om-style.textColor')
    || validateColorMember(value, 'accent', 'x-om-style.accent')
    || validateEnumMember(value, 'align', OM_TEXT_ALIGN, 'x-om-style.align')
  )
}
