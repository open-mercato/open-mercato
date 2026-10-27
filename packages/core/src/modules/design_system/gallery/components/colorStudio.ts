import { contrastRatio, normalizeHex } from './colorPreview'

export type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950
export type NeutralTone = 'neutral' | 'warm' | 'cool'
export type Harmony = 'analogous' | 'triadic' | 'split'
export type ColorStop = { step: Shade; hex: string }
export type StudioTheme = {
  tokens: Record<string, string>
  actionStep: Shade
  pairs: Array<{
    id: 'action' | 'hover' | 'body' | 'muted' | 'selection' | 'focus'
    foreground: string
    background: string
    ratio: number
    minimum: number
  }>
}
export type ColorStudio = {
  seeds: { primary: string; secondary: string; tertiary: string }
  scale: ColorStop[]
  secondaryScale: ColorStop[]
  tertiaryScale: ColorStop[]
  neutralScale: ColorStop[]
  light: StudioTheme
  dark: StudioTheme
}

type Rgb = [number, number, number]
type Oklch = { lightness: number; chroma: number; hue: number }
const STEPS: Shade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const LIGHTNESS = [0.98, 0.95, 0.9, 0.83, 0.74, 0.64, 0.54, 0.44, 0.35, 0.26, 0.18]

function linearChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function toOklch(hex: string): Oklch {
  const [red, green, blue] = [1, 3, 5].map((offset) => linearChannel(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255))
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  const lightness = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short
  const axisA = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short
  const axisB = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short
  return { lightness, chroma: Math.hypot(axisA, axisB), hue: Math.atan2(axisB, axisA) }
}

function toLinearRgb({ lightness, chroma, hue }: Oklch): Rgb {
  const axisA = chroma * Math.cos(hue)
  const axisB = chroma * Math.sin(hue)
  const long = (lightness + 0.3963377774 * axisA + 0.2158037573 * axisB) ** 3
  const medium = (lightness - 0.1055613458 * axisA - 0.0638541728 * axisB) ** 3
  const short = (lightness - 0.0894841775 * axisA - 1.291485548 * axisB) ** 3
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
}

function inGamut(channels: Rgb): boolean {
  return channels.every((channel) => channel >= -0.0000001 && channel <= 1.0000001)
}

function toHex(color: Oklch): string {
  let channels = toLinearRgb(color)
  if (!inGamut(channels)) {
    let low = 0
    let high = color.chroma
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const chroma = (low + high) / 2
      if (inGamut(toLinearRgb({ ...color, chroma }))) low = chroma
      else high = chroma
    }
    channels = toLinearRgb({ ...color, chroma: low })
  }
  return `#${channels.map((channel) => {
    const clamped = Math.max(0, Math.min(1, channel))
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255).toString(16).padStart(2, '0')
  }).join('').toUpperCase()}`
}

function subtleSurface(surface: string, accent: string): string {
  const base = toOklch(surface)
  const tint = toOklch(accent)
  const amount = 0.15
  const axisA = base.chroma * Math.cos(base.hue) * (1 - amount) + tint.chroma * Math.cos(tint.hue) * amount
  const axisB = base.chroma * Math.sin(base.hue) * (1 - amount) + tint.chroma * Math.sin(tint.hue) * amount
  return toHex({
    lightness: base.lightness * (1 - amount) + tint.lightness * amount,
    chroma: Math.hypot(axisA, axisB),
    hue: Math.atan2(axisB, axisA),
  })
}

function accentScale(hex: string): ColorStop[] {
  const seed = toOklch(hex)
  const anchor = LIGHTNESS.reduce((closest, value, index) => (
    Math.abs(value - seed.lightness) < Math.abs(LIGHTNESS[closest] - seed.lightness) ? index : closest
  ), 0)
  const seedEnvelope = Math.max(0.25, Math.sin(Math.PI * seed.lightness) ** 0.8)
  return STEPS.map((step, index) => {
    if (index === anchor) return { step, hex }
    const lightness = LIGHTNESS[index]
    const chroma = seed.chroma < 0.00001 ? 0 : Math.min(0.32, seed.chroma * Math.sin(Math.PI * lightness) ** 0.8 / seedEnvelope)
    return { step, hex: toHex({ lightness, chroma, hue: seed.hue }) }
  })
}

function neutralScale(tone: NeutralTone): ColorStop[] {
  const hue = (tone === 'warm' ? 75 : 255) * Math.PI / 180
  return STEPS.map((step, index) => ({
    step,
    hex: toHex({ lightness: LIGHTNESS[index], chroma: tone === 'neutral' ? 0 : 0.014 * Math.sin(Math.PI * LIGHTNESS[index]), hue }),
  }))
}

function atShade(scale: ColorStop[], shade: Shade): string {
  return scale.find((stop) => stop.step === shade)!.hex
}

function foregroundFor(background: string): string {
  return contrastRatio('#000000', background) >= contrastRatio('#FFFFFF', background) ? '#000000' : '#FFFFFF'
}

function nearestReadable(scale: ColorStop[], target: Shade, background: string, minimum: number): string {
  const targetIndex = STEPS.indexOf(target)
  return scale.filter((stop) => contrastRatio(stop.hex, background) >= minimum)
    .sort((first, second) => Math.abs(STEPS.indexOf(first.step) - targetIndex) - Math.abs(STEPS.indexOf(second.step) - targetIndex))[0]?.hex ?? foregroundFor(background)
}

function themeFor(scale: ColorStop[], neutrals: ColorStop[], dark: boolean, actionStep: Shade, secondary: ColorStop[], tertiary: ColorStop[]): StudioTheme {
  const background = atShade(neutrals, dark ? 950 : 50)
  const card = dark ? atShade(neutrals, 900) : '#FFFFFF'
  const foreground = atShade(neutrals, dark ? 50 : 950)
  const muted = atShade(neutrals, dark ? 800 : 100)
  const mutedForeground = nearestReadable(neutrals, dark ? 300 : 600, muted, 4.5)
  const primary = atShade(scale, actionStep)
  const primaryForeground = foregroundFor(primary)
  const actionIndex = STEPS.indexOf(actionStep)
  const hoverIndex = Math.max(0, Math.min(STEPS.length - 1, actionIndex + (primaryForeground === '#FFFFFF' ? 1 : -1)))
  const hoverCandidate = scale[hoverIndex].hex
  const hover = contrastRatio(primaryForeground, hoverCandidate) >= 4.5 ? hoverCandidate : primary
  const accent = dark ? subtleSurface(card, primary) : atShade(scale, 100)
  const accentForeground = nearestReadable(scale, dark ? 200 : 800, accent, 4.5)
  const focus = nearestReadable(scale, actionStep, background, 3)
  const input = atShade(neutrals, dark ? 600 : 300)
  const selection = scale.filter((stop) => contrastRatio(stop.hex, input) >= 3 && contrastRatio(stop.hex, background) >= 3)
    .sort((first, second) => Math.abs(STEPS.indexOf(first.step) - actionIndex) - Math.abs(STEPS.indexOf(second.step) - actionIndex))[0]?.hex ?? foregroundFor(background)
  const selectionForeground = foregroundFor(selection)
  const categoryTokens = (name: string, colors: ColorStop[]) => {
    const strong = atShade(colors, dark ? 400 : 600)
    const soft = dark ? subtleSurface(card, strong) : atShade(colors, 100)
    return {
      [`--studio-${name}`]: strong,
      [`--studio-${name}-foreground`]: foregroundFor(strong),
      [`--studio-${name}-soft`]: soft,
      [`--studio-${name}-soft-foreground`]: nearestReadable(colors, dark ? 200 : 800, soft, 4.5),
    }
  }
  const tokens: Record<string, string> = {
    ...categoryTokens('secondary', secondary),
    ...categoryTokens('tertiary', tertiary),
    '--background': background,
    '--foreground': foreground,
    '--card': card,
    '--card-foreground': foreground,
    '--popover': card,
    '--popover-foreground': foreground,
    '--muted': muted,
    '--muted-foreground': mutedForeground,
    '--secondary': muted,
    '--secondary-foreground': foreground,
    '--border': atShade(neutrals, dark ? 700 : 200),
    '--input': input,
    '--bg-disabled': muted,
    '--text-disabled': atShade(neutrals, dark ? 500 : 400),
    '--border-disabled': atShade(neutrals, dark ? 700 : 200),
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--primary-hover': hover,
    '--accent': accent,
    '--accent-foreground': accentForeground,
    '--accent-indigo': selection,
    '--accent-indigo-foreground': selectionForeground,
    '--ring': focus,
    '--focus-ring-inner': background,
    '--focus-ring-outer': focus,
  }
  const pair = (id: StudioTheme['pairs'][number]['id'], text: string, surface: string, minimum = 4.5) => ({
    id, foreground: text, background: surface, ratio: contrastRatio(text, surface), minimum,
  })
  return {
    tokens,
    actionStep,
    pairs: [
      pair('action', primaryForeground, primary),
      pair('hover', primaryForeground, hover),
      pair('body', foreground, background),
      pair('muted', mutedForeground, muted),
      pair('selection', accentForeground, accent),
      pair('focus', focus, background, 3),
    ],
  }
}

export function createHarmonySeeds(seed: string, harmony: Harmony): { secondary: string; tertiary: string } {
  const color = toOklch(normalizeHex(seed) ?? '#F4700D')
  const offset = ({ analogous: 30, triadic: 120, split: 150 }[harmony]) * Math.PI / 180
  const lightness = Math.max(0.55, Math.min(0.72, color.lightness))
  const chroma = Math.max(0.1, Math.min(0.18, color.chroma))
  const hue = color.chroma < 0.00001 ? 0 : color.hue
  return {
    secondary: toHex({ lightness, chroma, hue: hue + offset }),
    tertiary: toHex({ lightness, chroma, hue: hue - offset }),
  }
}

export function createColorStudio(
  seed: string,
  neutral: NeutralTone,
  actionShades: { light?: Shade; dark?: Shade } = {},
  colors: { secondary?: string; tertiary?: string; harmony?: Harmony } = {},
): ColorStudio {
  const primary = normalizeHex(seed) ?? '#F4700D'
  const derived = createHarmonySeeds(primary, colors.harmony ?? 'triadic')
  const seeds = {
    primary,
    secondary: normalizeHex(colors.secondary ?? '') ?? derived.secondary,
    tertiary: normalizeHex(colors.tertiary ?? '') ?? derived.tertiary,
  }
  const scale = accentScale(primary)
  const secondary = accentScale(seeds.secondary)
  const tertiary = accentScale(seeds.tertiary)
  const neutrals = neutralScale(neutral)
  return {
    seeds,
    scale,
    secondaryScale: secondary,
    tertiaryScale: tertiary,
    neutralScale: neutrals,
    light: themeFor(scale, neutrals, false, actionShades.light ?? 600, secondary, tertiary),
    dark: themeFor(scale, neutrals, true, actionShades.dark ?? 400, secondary, tertiary),
  }
}

export function exportColorStudio(studio: ColorStudio, format: 'css' | 'json'): string {
  const scales = {
    accent: Object.fromEntries(studio.scale.map((stop) => [stop.step, stop.hex])),
    secondary: Object.fromEntries(studio.secondaryScale.map((stop) => [stop.step, stop.hex])),
    tertiary: Object.fromEntries(studio.tertiaryScale.map((stop) => [stop.step, stop.hex])),
    neutral: Object.fromEntries(studio.neutralScale.map((stop) => [stop.step, stop.hex])),
  }
  if (format === 'json') return JSON.stringify({ seeds: studio.seeds, scales, themes: { light: studio.light.tokens, dark: studio.dark.tokens } }, null, 2)
  const scaleTokens = Object.fromEntries(Object.entries(scales).flatMap(([name, stops]) => Object.entries(stops).map(([step, hex]) => [`--palette-${name}-${step}`, hex])))
  return (['light', 'dark'] as const).map((theme) => (
    `.ds-color-preview-${theme} {\n${Object.entries({ ...scaleTokens, ...studio[theme].tokens }).map(([token, value]) => `  ${token}: ${value};`).join('\n')}\n}`
  )).join('\n\n')
}
