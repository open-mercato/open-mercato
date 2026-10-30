import { z } from 'zod'

export const BRAND_STYLE_STORAGE_KEY = 'om-brand-style-v1'
export const BRAND_STYLE_EVENT = 'om-brand-style-change'
export const BRAND_STYLE_ELEMENT_ID = 'om-brand-style'

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i)
const tokensSchema = z.object({
  '--primary': hexColor,
  '--primary-hover': hexColor,
  '--primary-foreground': hexColor,
  '--brand-lime': hexColor.optional(),
  '--brand-yellow': hexColor.optional(),
  '--brand-violet': hexColor.optional(),
  '--brand-violet-foreground': hexColor.optional(),
}).strict()

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function readable(foreground: string, background: string): boolean {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) >= 4.5
}

const shade = z.union([z.literal(50), z.literal(100), z.literal(200), z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900), z.literal(950)])

const brandStyleSchema = z.object({
  version: z.literal(1),
  logo: z.string().max(1_400_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
  light: tokensSchema,
  dark: tokensSchema,
  actionShades: z.object({ light: shade, dark: shade }).strict().optional(),
  seeds: z.object({ primary: hexColor, secondary: hexColor, tertiary: hexColor }).strict().optional(),
}).strict().refine(style => [style.light, style.dark].every(tokens =>
  readable(tokens['--primary-foreground'], tokens['--primary'])
  && readable(tokens['--primary-foreground'], tokens['--primary-hover'])
  && [tokens['--brand-lime'], tokens['--brand-yellow'], tokens['--brand-violet']].every(color => !color || Boolean(tokens['--brand-violet-foreground'] && readable(tokens['--brand-violet-foreground'], color))),
))

export type BrandStyle = {
  version: 1
  logo: string | null
  light: Record<string, string>
  dark: Record<string, string>
  actionShades?: { light: number; dark: number }
  seeds?: { primary: string; secondary: string; tertiary: string }
}

let cachedRaw: string | null | undefined
let cachedStyle: BrandStyle | null = null

export function getBrandStyle(): BrandStyle | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try { raw = window.localStorage.getItem(BRAND_STYLE_STORAGE_KEY) } catch { return null }
  if (raw === cachedRaw) return cachedStyle
  cachedRaw = raw
  cachedStyle = null
  if (!raw || raw.length > 1_410_000) return null
  try {
    const result = brandStyleSchema.safeParse(JSON.parse(raw))
    if (result.success) cachedStyle = result.data
  } catch { return null }
  return cachedStyle
}

export function saveBrandStyle(style: BrandStyle | null): void {
  if (style === null) window.localStorage.removeItem(BRAND_STYLE_STORAGE_KEY)
  else {
    const result = brandStyleSchema.safeParse(style)
    if (!result.success) throw new Error('[internal] Invalid brand style')
    window.localStorage.setItem(BRAND_STYLE_STORAGE_KEY, JSON.stringify(result.data))
  }
  window.dispatchEvent(new Event(BRAND_STYLE_EVENT))
}

export function subscribeBrandStyle(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === BRAND_STYLE_STORAGE_KEY || event.key === null) onChange()
  }
  window.addEventListener(BRAND_STYLE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(BRAND_STYLE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function brandStyleCss(style: BrandStyle): string {
  const parsed = brandStyleSchema.parse(style)
  const rule = (selector: string, tokens: Record<string, string | undefined>) => `${selector}{${Object.entries(tokens).filter(([, value]) => value).map(([key, value]) => `${key}:${value};`).join('')}}`
  return `${rule(':root:not(.dark)', parsed.light)}\n${rule(':root.dark', parsed.dark)}`
}
