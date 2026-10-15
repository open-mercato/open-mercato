import { z } from 'zod'
import { ecommerceStoreBrandingSchema, isSafeAssetUrl } from '../data/validators'
import {
  ECOMMERCE_BRANDING_COLOR_KEYS,
  ECOMMERCE_BRANDING_DEFAULTS,
  ECOMMERCE_BRANDING_FONT_KEYS,
  findEcommerceBrandingFont,
  isValidBorderRadius,
  normalizeBrandingColor,
  renderBrandingRootRule,
  type EcommerceBrandingColorKey,
  type EcommerceBrandingFontKey,
} from '../lib/brandingStyles'
import type { StoreAdminRecord } from './storeAdmin'

export const BRANDING_COLOR_KEYS = ECOMMERCE_BRANDING_COLOR_KEYS
export const BRANDING_FONT_KEYS = ECOMMERCE_BRANDING_FONT_KEYS
export const BRANDING_ASSET_KEYS = ['logoUrl', 'faviconUrl'] as const

export type BrandingAssetKey = (typeof BRANDING_ASSET_KEYS)[number]
export type StoreBrandingFormKey =
  | EcommerceBrandingColorKey
  | EcommerceBrandingFontKey
  | BrandingAssetKey
  | 'borderRadius'

export type StoreBrandingFormValues = Record<StoreBrandingFormKey, string>

export type StoreBrandingPayload = Partial<Record<StoreBrandingFormKey, string>>

export const BRANDING_FONT_INHERIT = 'inherit'
export const DEFAULT_BASE_FONT_ID = 'inter'
export const RADIUS_SLIDER_MIN = 0
export const RADIUS_SLIDER_MAX = 5
export const RADIUS_SLIDER_STEP = 0.125
const PX_PER_REM = 16

export const STORE_BRANDING_API_PATH = (storeId: string) => `/api/ecommerce/stores/${encodeURIComponent(storeId)}/branding`

const ALL_KEYS: readonly StoreBrandingFormKey[] = [
  ...BRANDING_COLOR_KEYS,
  'borderRadius',
  ...BRANDING_FONT_KEYS,
  ...BRANDING_ASSET_KEYS,
]

function readStoredBranding(store: Pick<StoreAdminRecord, 'settings'>): Record<string, unknown> {
  const branding = store.settings?.branding
  return typeof branding === 'object' && branding !== null && !Array.isArray(branding)
    ? (branding as Record<string, unknown>)
    : {}
}

function readStoredString(stored: Record<string, unknown>, key: string): string {
  const value = stored[key]
  return typeof value === 'string' ? value : ''
}

export function buildStoreBrandingInitialValues(store: Pick<StoreAdminRecord, 'settings'>): StoreBrandingFormValues {
  const stored = readStoredBranding(store)
  const values = {} as StoreBrandingFormValues
  for (const key of BRANDING_COLOR_KEYS) {
    values[key] = readStoredString(stored, key) || ECOMMERCE_BRANDING_DEFAULTS[key]
  }
  values.borderRadius = readStoredString(stored, 'borderRadius') || ECOMMERCE_BRANDING_DEFAULTS.borderRadius
  values.fontFamilyBase = readStoredString(stored, 'fontFamilyBase') || DEFAULT_BASE_FONT_ID
  values.fontFamilyHeading = readStoredString(stored, 'fontFamilyHeading') || BRANDING_FONT_INHERIT
  values.logoUrl = readStoredString(stored, 'logoUrl')
  values.faviconUrl = readStoredString(stored, 'faviconUrl')
  return values
}

function readFormString(values: Record<string, unknown>, key: string): string {
  const value = values[key]
  return typeof value === 'string' ? value.trim() : ''
}

function defaultValueFor(key: StoreBrandingFormKey): string | null {
  if (key === 'fontFamilyBase') return DEFAULT_BASE_FONT_ID
  if (key === 'fontFamilyHeading') return BRANDING_FONT_INHERIT
  if (key === 'logoUrl' || key === 'faviconUrl') return null
  return ECOMMERCE_BRANDING_DEFAULTS[key]
}

export function buildStoreBrandingInput(values: Record<string, unknown>): StoreBrandingPayload {
  const input: StoreBrandingPayload = {}
  for (const key of ALL_KEYS) {
    const value = readFormString(values, key)
    if (value === '' || value === BRANDING_FONT_INHERIT) continue
    input[key] = value
  }
  return input
}

export function buildStoreBrandingPayload(
  values: Record<string, unknown>,
  store: Pick<StoreAdminRecord, 'settings'>,
): StoreBrandingPayload {
  const stored = readStoredBranding(store)
  const input = buildStoreBrandingInput(values)
  const payload: StoreBrandingPayload = {}
  for (const key of ALL_KEYS) {
    const value = input[key]
    if (value === undefined) continue
    const wasStored = readStoredString(stored, key) !== ''
    if (!wasStored && value === defaultValueFor(key)) continue
    payload[key] = value
  }
  return payload
}

const brandingFormShape = {
  primaryColor: z.string(),
  primaryForeground: z.string(),
  accentColor: z.string(),
  accentForeground: z.string(),
  backgroundColor: z.string(),
  foregroundColor: z.string(),
  borderRadius: z.string(),
  fontFamilyBase: z.string(),
  fontFamilyHeading: z.string(),
  logoUrl: z.string(),
  faviconUrl: z.string(),
} satisfies Record<StoreBrandingFormKey, z.ZodString>

export const storeBrandingFormSchema = z.object(brandingFormShape).superRefine((values, context) => {
  const result = ecommerceStoreBrandingSchema.safeParse(buildStoreBrandingInput(values))
  if (result.success) return
  for (const issue of result.error.issues) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
})

export function parseRadiusRem(value: string): number {
  const trimmed = value.trim()
  if (trimmed === '0') return 0
  const match = /^(\d+(?:\.\d+)?|\.\d+)(rem|px)$/.exec(trimmed)
  if (!match) return parseRadiusRem(ECOMMERCE_BRANDING_DEFAULTS.borderRadius)
  const amount = Number(match[1])
  const rem = match[2] === 'px' ? amount / PX_PER_REM : amount
  return Math.min(RADIUS_SLIDER_MAX, Math.max(RADIUS_SLIDER_MIN, rem))
}

export function formatRadiusRem(rem: number): string {
  if (rem <= 0) return '0'
  return `${Number(rem.toFixed(3))}rem`
}

export type SanitizedPreviewBranding = Partial<Record<StoreBrandingFormKey, string>>

export function sanitizePreviewBranding(values: Record<string, unknown>): SanitizedPreviewBranding {
  const input = buildStoreBrandingInput(values)
  const sanitized: SanitizedPreviewBranding = {}
  for (const key of BRANDING_COLOR_KEYS) {
    const raw = input[key]
    const normalized = raw === undefined ? null : normalizeBrandingColor(raw)
    if (normalized !== null) sanitized[key] = normalized
  }
  const radius = input.borderRadius
  if (radius !== undefined && isValidBorderRadius(radius)) sanitized.borderRadius = radius
  for (const key of BRANDING_FONT_KEYS) {
    const raw = input[key]
    if (raw !== undefined && findEcommerceBrandingFont(raw)) sanitized[key] = raw
  }
  const logo = input.logoUrl
  if (logo !== undefined && isSafeAssetUrl(logo)) sanitized.logoUrl = logo
  return sanitized
}

export type BrandingPreviewLabels = {
  storeName: string
  navShop: string
  navCategories: string
  navCart: string
  heroTitle: string
  heroText: string
  heroButton: string
  productName: string
  productPrice: string
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

const PREVIEW_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src http: https:"

const PREVIEW_STATIC_CSS = [
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-base);font-size:14px;line-height:1.5}',
  'h1,.brand{font-family:var(--font-heading)}',
  '.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid color-mix(in oklch,var(--foreground) 15%,transparent)}',
  '.brand{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700}',
  '.brand img{max-width:120px;max-height:28px}',
  'nav{display:flex;gap:16px;opacity:.7}',
  '.hero{padding:28px 20px;background:var(--accent);color:var(--accent-foreground)}',
  '.hero h1{margin:0 0 8px;font-size:24px;line-height:1.2}',
  '.hero p{margin:0 0 16px;max-width:36ch}',
  '.btn{display:inline-block;padding:8px 16px;border-radius:var(--radius);background:var(--primary);color:var(--primary-foreground);font-weight:600}',
  '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:20px}',
  '.card{overflow:hidden;border:1px solid color-mix(in oklch,var(--foreground) 15%,transparent);border-radius:var(--radius)}',
  '.thumb{height:56px;background:color-mix(in oklch,var(--primary) 20%,var(--background))}',
  '.card-body{padding:10px}',
  '.price{font-weight:600}',
].join('')

export function buildBrandingPreviewDocument(values: Record<string, unknown>, labels: BrandingPreviewLabels): string {
  const branding = sanitizePreviewBranding(values)
  const rootRule = renderBrandingRootRule(branding)
  const logo = branding.logoUrl ? `<img src="${escapeHtml(branding.logoUrl)}" alt="">` : ''
  const card = `<div class="card"><div class="thumb"></div><div class="card-body"><div>${escapeHtml(labels.productName)}</div><div class="price">${escapeHtml(labels.productPrice)}</div></div></div>`
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`,
    `<style>${rootRule}</style><style>${PREVIEW_STATIC_CSS}</style></head><body>`,
    `<header class="bar"><div class="brand">${logo}<span>${escapeHtml(labels.storeName)}</span></div>`,
    `<nav><span>${escapeHtml(labels.navShop)}</span><span>${escapeHtml(labels.navCategories)}</span><span>${escapeHtml(labels.navCart)}</span></nav></header>`,
    `<section class="hero"><h1>${escapeHtml(labels.heroTitle)}</h1><p>${escapeHtml(labels.heroText)}</p><span class="btn">${escapeHtml(labels.heroButton)}</span></section>`,
    `<section class="grid">${card}${card}${card}</section>`,
    '</body></html>',
  ].join('')
}
