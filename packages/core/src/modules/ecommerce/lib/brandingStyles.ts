export type EcommerceBrandingFont = {
  id: string
  label: string
  stack: string
  googleFamily: string | null
}

export const ECOMMERCE_BRANDING_FONTS: readonly EcommerceBrandingFont[] = [
  {
    id: 'system-sans',
    label: 'System sans-serif',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    googleFamily: null,
  },
  { id: 'system-serif', label: 'System serif', stack: "Georgia, 'Times New Roman', Times, serif", googleFamily: null },
  {
    id: 'system-mono',
    label: 'System monospace',
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    googleFamily: null,
  },
  { id: 'inter', label: 'Inter', stack: "'Inter', sans-serif", googleFamily: 'Inter' },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', sans-serif", googleFamily: 'Roboto' },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans', sans-serif", googleFamily: 'Open Sans' },
  { id: 'lato', label: 'Lato', stack: "'Lato', sans-serif", googleFamily: 'Lato' },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', sans-serif", googleFamily: 'Montserrat' },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', sans-serif", googleFamily: 'Poppins' },
  { id: 'dm-sans', label: 'DM Sans', stack: "'DM Sans', sans-serif", googleFamily: 'DM Sans' },
  { id: 'merriweather', label: 'Merriweather', stack: "'Merriweather', serif", googleFamily: 'Merriweather' },
  {
    id: 'playfair-display',
    label: 'Playfair Display',
    stack: "'Playfair Display', serif",
    googleFamily: 'Playfair Display',
  },
]

export const ecommerceBrandingFontIds: readonly string[] = ECOMMERCE_BRANDING_FONTS.map((font) => font.id)

export function findEcommerceBrandingFont(id: string): EcommerceBrandingFont | null {
  return ECOMMERCE_BRANDING_FONTS.find((font) => font.id === id) ?? null
}

const NUMBER_PATTERN = '(\\d+(?:\\.\\d+)?|\\.\\d+)'
const OKLCH_PATTERN = new RegExp(
  `^oklch\\(\\s*${NUMBER_PATTERN}(%?)\\s+${NUMBER_PATTERN}(%?)\\s+${NUMBER_PATTERN}(deg)?\\s*(?:\\/\\s*${NUMBER_PATTERN}(%?)\\s*)?\\)$`,
)
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const BORDER_RADIUS_PATTERN = /^(\d+(?:\.\d+)?|\.\d+)(rem|px)$/

const OKLCH_CHROMA_MAX = 0.5
const OKLCH_HUE_MAX = 360
const BORDER_RADIUS_REM_MAX = 5
const BORDER_RADIUS_PX_MAX = 80

function withinBounds(raw: string, percent: boolean, numericMax: number): boolean {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return false
  return percent ? value <= 100 : value <= numericMax
}

export function isValidOklchColor(value: string): boolean {
  return normalizeOklchColor(value) !== null
}

function normalizeOklchColor(value: string): string | null {
  const match = OKLCH_PATTERN.exec(value)
  if (!match) return null
  const [, lightness, lightnessPercent, chroma, chromaPercent, hue, hueUnit, alpha, alphaPercent] = match
  if (!withinBounds(lightness, lightnessPercent === '%', 1)) return null
  if (!withinBounds(chroma, chromaPercent === '%', OKLCH_CHROMA_MAX)) return null
  if (!withinBounds(hue, false, OKLCH_HUE_MAX)) return null
  if (alpha !== undefined && !withinBounds(alpha, alphaPercent === '%', 1)) return null
  const alphaPart = alpha === undefined ? '' : ` / ${alpha}${alphaPercent}`
  return `oklch(${lightness}${lightnessPercent} ${chroma}${chromaPercent} ${hue}${hueUnit ?? ''}${alphaPart})`
}

export function isValidBrandingColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value) || isValidOklchColor(value)
}

export function normalizeBrandingColor(value: string): string | null {
  if (HEX_COLOR_PATTERN.test(value)) return value.toLowerCase()
  return normalizeOklchColor(value)
}

export function isValidBorderRadius(value: string): boolean {
  if (value === '0') return true
  const match = BORDER_RADIUS_PATTERN.exec(value)
  if (!match) return false
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return false
  return match[2] === 'rem' ? amount <= BORDER_RADIUS_REM_MAX : amount <= BORDER_RADIUS_PX_MAX
}

export const ECOMMERCE_BRANDING_COLOR_KEYS = [
  'primaryColor',
  'primaryForeground',
  'accentColor',
  'accentForeground',
  'backgroundColor',
  'foregroundColor',
] as const

export const ECOMMERCE_BRANDING_FONT_KEYS = ['fontFamilyBase', 'fontFamilyHeading'] as const

export type EcommerceBrandingColorKey = (typeof ECOMMERCE_BRANDING_COLOR_KEYS)[number]
export type EcommerceBrandingFontKey = (typeof ECOMMERCE_BRANDING_FONT_KEYS)[number]
export type EcommerceBrandingTokenKey = EcommerceBrandingColorKey | 'borderRadius' | EcommerceBrandingFontKey

export type EcommerceBrandingDeclaration = {
  property: string
  value: string
}

const BRANDING_PROPERTY_BY_KEY: Readonly<Record<EcommerceBrandingTokenKey, string>> = {
  primaryColor: '--primary',
  primaryForeground: '--primary-foreground',
  accentColor: '--accent',
  accentForeground: '--accent-foreground',
  backgroundColor: '--background',
  foregroundColor: '--foreground',
  borderRadius: '--radius',
  fontFamilyBase: '--font-base',
  fontFamilyHeading: '--font-heading',
}

const BRANDING_TOKEN_ORDER: readonly EcommerceBrandingTokenKey[] = [
  'primaryColor',
  'primaryForeground',
  'accentColor',
  'accentForeground',
  'backgroundColor',
  'foregroundColor',
  'borderRadius',
  'fontFamilyBase',
  'fontFamilyHeading',
]

export const ECOMMERCE_BRANDING_CSS_PROPERTIES: readonly string[] = BRANDING_TOKEN_ORDER.map(
  (key) => BRANDING_PROPERTY_BY_KEY[key],
)

const DEFAULT_FONT_BASE_ID = 'inter'
const HEADING_INHERITS_BASE = 'var(--font-base)'

export const ECOMMERCE_BRANDING_DEFAULTS: Readonly<Record<EcommerceBrandingColorKey | 'borderRadius', string>> = {
  primaryColor: 'oklch(0.205 0 0)',
  primaryForeground: 'oklch(0.985 0 0)',
  accentColor: 'oklch(0.97 0 0)',
  accentForeground: 'oklch(0.205 0 0)',
  backgroundColor: 'oklch(1 0 0)',
  foregroundColor: 'oklch(0.145 0 0)',
  borderRadius: '0.625rem',
}

const NONCE_PATTERN = /^[A-Za-z0-9+/_-]{8,128}={0,2}$/

function readOwnString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null
  if (!Object.prototype.hasOwnProperty.call(source, key)) return null
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function resolveColor(source: unknown, key: EcommerceBrandingColorKey): string {
  const raw = readOwnString(source, key)
  return (raw === null ? null : normalizeBrandingColor(raw)) ?? ECOMMERCE_BRANDING_DEFAULTS[key]
}

function resolveBorderRadius(source: unknown): string {
  const raw = readOwnString(source, 'borderRadius')
  return raw !== null && isValidBorderRadius(raw) ? raw : ECOMMERCE_BRANDING_DEFAULTS.borderRadius
}

function resolveFontStack(source: unknown, key: EcommerceBrandingFontKey): string | null {
  const raw = readOwnString(source, key)
  const font = raw === null ? null : findEcommerceBrandingFont(raw)
  return font ? font.stack : null
}

export function buildBrandingDeclarations(branding: unknown): EcommerceBrandingDeclaration[] {
  const baseStack =
    resolveFontStack(branding, 'fontFamilyBase') ?? findEcommerceBrandingFont(DEFAULT_FONT_BASE_ID)?.stack ?? 'sans-serif'
  const headingStack = resolveFontStack(branding, 'fontFamilyHeading') ?? HEADING_INHERITS_BASE
  const values: Record<EcommerceBrandingTokenKey, string> = {
    primaryColor: resolveColor(branding, 'primaryColor'),
    primaryForeground: resolveColor(branding, 'primaryForeground'),
    accentColor: resolveColor(branding, 'accentColor'),
    accentForeground: resolveColor(branding, 'accentForeground'),
    backgroundColor: resolveColor(branding, 'backgroundColor'),
    foregroundColor: resolveColor(branding, 'foregroundColor'),
    borderRadius: resolveBorderRadius(branding),
    fontFamilyBase: baseStack,
    fontFamilyHeading: headingStack,
  }
  return BRANDING_TOKEN_ORDER.map((key) => ({ property: BRANDING_PROPERTY_BY_KEY[key], value: values[key] }))
}

export function renderBrandingRootRule(branding: unknown): string {
  const body = buildBrandingDeclarations(branding)
    .map((declaration) => `${declaration.property}:${declaration.value}`)
    .join(';')
  return `:root{${body}}`
}

export type BrandingStyleBlockOptions = {
  nonce?: string | null
}

export function renderBrandingStyleBlock(branding: unknown, options: BrandingStyleBlockOptions = {}): string {
  const nonce = typeof options.nonce === 'string' && NONCE_PATTERN.test(options.nonce) ? options.nonce : null
  const attributes = nonce ? ` nonce="${nonce}"` : ''
  return `<style data-ecommerce-branding${attributes}>${renderBrandingRootRule(branding)}</style>`
}
