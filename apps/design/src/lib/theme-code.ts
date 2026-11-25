import type { ColorStudio } from '@open-mercato/core/modules/design_system/gallery/components/colorStudio'
import { designScopeRadiusStyle } from '@open-mercato/ui/primitives/design-scope'
import type { ThemePreset } from './theme-preset'

export type ThemeCodeFormat = 'css' | 'react' | 'json'

function block(selector: string, tokens: Record<string, string>): string {
  return `${selector} {\n${Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`
}

function stop(scale: ColorStudio['scale'], step: number): string {
  return scale.find((item) => item.step === step)?.hex ?? scale[5].hex
}

export function accentTokens(studio: ColorStudio, mode: 'light' | 'dark'): Record<string, string> {
  const strong = mode === 'dark' ? 400 : 600
  const soft = mode === 'dark' ? 300 : 400
  return {
    '--chart-1': studio[mode].tokens['--primary'],
    '--chart-2': stop(studio.secondaryScale, strong),
    '--chart-3': stop(studio.tertiaryScale, strong),
    '--chart-4': stop(studio.secondaryScale, soft),
    '--chart-5': stop(studio.tertiaryScale, soft),
    '--brand-lime': stop(studio.secondaryScale, 200),
    '--brand-yellow': stop(studio.scale, 200),
    '--brand-violet': stop(studio.tertiaryScale, strong),
    '--brand-violet-foreground': studio[mode].tokens['--studio-tertiary-foreground'] ?? '#FFFFFF',
  }
}

export function themeTokens(studio: ColorStudio, mode: 'light' | 'dark'): Record<string, string> {
  return { ...studio[mode].tokens, ...accentTokens(studio, mode) }
}

export function radiusTokens(preset: ThemePreset): Record<string, string> {
  const style = designScopeRadiusStyle(preset.shape) ?? {}
  return Object.fromEntries(Object.entries(style).map(([name, value]) => [name, String(value)]))
}

export function themeCss(studio: ColorStudio, preset: ThemePreset): string {
  const light = { ...themeTokens(studio, 'light'), ...radiusTokens(preset) }
  const parts = [block(':root', light), block('.dark', themeTokens(studio, 'dark'))]
  if (preset.density === 'compact') parts.push('/* Compact density: add data-density="compact" to <body> or wrap regions in <DesignScope density="compact">. */')
  return parts.join('\n\n')
}

export function themeReact(preset: ThemePreset, code: string): string {
  const props = [preset.density !== 'default' ? ` density="${preset.density}"` : '', preset.shape !== 'default' ? ` shape="${preset.shape}"` : ''].join('')
  return `import { DesignScope } from '@open-mercato/ui/primitives/design-scope'

// Colours: paste the CSS tab into your app stylesheet.
// Preset: /create?preset=${code}
export function ThemedRegion({ children }: { children: React.ReactNode }) {
  return <DesignScope${props}>{children}</DesignScope>
}`
}

export function themeJson(studio: ColorStudio, preset: ThemePreset): string {
  return JSON.stringify(
    {
      preset,
      seeds: studio.seeds,
      radius: radiusTokens(preset),
      themes: { light: themeTokens(studio, 'light'), dark: themeTokens(studio, 'dark') },
    },
    null,
    2,
  )
}

export function themeCode(format: ThemeCodeFormat, studio: ColorStudio, preset: ThemePreset, code: string): string {
  if (format === 'css') return themeCss(studio, preset)
  if (format === 'react') return themeReact(preset, code)
  return themeJson(studio, preset)
}
