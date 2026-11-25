import { z } from 'zod'

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
export type PresetShade = (typeof SHADES)[number]

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const shade = z.union(SHADES.map((value) => z.literal(value)) as unknown as [z.ZodLiteral<50>, z.ZodLiteral<100>, ...z.ZodLiteral<PresetShade>[]])

export const themePresetSchema = z.object({
  v: z.literal(1),
  primary: hex,
  harmony: z.enum(['analogous', 'triadic', 'split']),
  secondary: hex.optional(),
  tertiary: hex.optional(),
  neutral: z.enum(['neutral', 'warm', 'cool']),
  light: shade,
  dark: shade,
  shape: z.enum(['default', 'round', 'sharp']),
  density: z.enum(['default', 'compact']),
})

export type ThemePreset = z.infer<typeof themePresetSchema>

export const NAMED_PRESETS: Record<string, ThemePreset> = {
  mercato: { v: 1, primary: '#F4700D', harmony: 'triadic', neutral: 'neutral', light: 600, dark: 400, shape: 'default', density: 'default' },
  ocean: { v: 1, primary: '#2563EB', harmony: 'analogous', neutral: 'cool', light: 600, dark: 400, shape: 'round', density: 'default' },
  forest: { v: 1, primary: '#15803D', harmony: 'split', neutral: 'warm', light: 700, dark: 400, shape: 'default', density: 'default' },
  graphite: { v: 1, primary: '#4B5563', harmony: 'analogous', neutral: 'neutral', light: 700, dark: 300, shape: 'sharp', density: 'compact' },
  berry: { v: 1, primary: '#BE185D', harmony: 'triadic', neutral: 'warm', light: 600, dark: 400, shape: 'round', density: 'default' },
}

export const DEFAULT_PRESET: ThemePreset = NAMED_PRESETS.mercato

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export function encodePreset(preset: ThemePreset): string {
  return toBase64Url(JSON.stringify(themePresetSchema.parse(preset)))
}

export function decodePreset(value: string | null | undefined): ThemePreset | null {
  if (!value) return null
  if (NAMED_PRESETS[value]) return NAMED_PRESETS[value]
  if (value.length > 400) return null
  try {
    const parsed = themePresetSchema.safeParse(JSON.parse(fromBase64Url(value)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100
  const l = lightness / 100
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  return `#${[channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function shufflePreset(random: () => number = Math.random): ThemePreset {
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length) % values.length]
  return {
    v: 1,
    primary: hslToHex(Math.floor(random() * 360), 55 + Math.floor(random() * 30), 38 + Math.floor(random() * 14)),
    harmony: pick(['analogous', 'triadic', 'split'] as const),
    neutral: pick(['neutral', 'warm', 'cool'] as const),
    light: pick([600, 700] as const),
    dark: pick([300, 400] as const),
    shape: pick(['default', 'round', 'sharp'] as const),
    density: pick(['default', 'compact'] as const),
  }
}

export function namedPresetId(preset: ThemePreset): string | null {
  const key = JSON.stringify(preset)
  return Object.entries(NAMED_PRESETS).find(([, value]) => JSON.stringify(value) === key)?.[0] ?? null
}
