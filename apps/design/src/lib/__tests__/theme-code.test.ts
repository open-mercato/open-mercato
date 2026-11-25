import fs from 'node:fs'
import path from 'node:path'
import { createColorStudio } from '@open-mercato/core/modules/design_system/gallery/components/colorStudio'
import { themeCode, themeCss, themeTokens } from '../theme-code'
import { NAMED_PRESETS } from '../theme-preset'

describe('theme code', () => {
  const preset = NAMED_PRESETS.ocean
  const studio = createColorStudio(preset.primary, preset.neutral, { light: preset.light, dark: preset.dark }, { harmony: preset.harmony })

  it('writes light tokens with radius roles on :root and dark tokens on .dark', () => {
    const css = themeCss(studio, preset)
    expect(css).toMatch(/^:root \{/)
    expect(css).toContain(`--primary: ${studio.light.tokens['--primary']};`)
    expect(css).toContain('--om-radius-button: 9999px;')
    expect(css).toContain(`.dark {\n`)
    expect(css).toContain(`--primary: ${studio.dark.tokens['--primary']};`)
  })

  it('maps the secondary and tertiary colours onto chart and brand tokens', () => {
    const custom = createColorStudio('#2563EB', 'neutral', {}, { secondary: '#16A34A', tertiary: '#DB2777' })
    const tokens = themeTokens(custom, 'light')
    expect(tokens['--chart-1']).toBe(custom.light.tokens['--primary'])
    expect(tokens['--chart-2']).toBe(custom.secondaryScale.find((item) => item.step === 600)?.hex)
    expect(tokens['--brand-violet']).toBe(custom.tertiaryScale.find((item) => item.step === 600)?.hex)
    expect(themeTokens(custom, 'dark')['--chart-2']).toBe(custom.secondaryScale.find((item) => item.step === 400)?.hex)
  })

  it('notes compact density and renders React and JSON formats', () => {
    const mono = NAMED_PRESETS.mono
    expect(themeCss(studio, mono)).toContain('data-density="compact"')
    expect(themeCode('react', studio, mono, 'abc')).toContain('<DesignScope density="compact" shape="sharp">')
    const json = JSON.parse(themeCode('json', studio, preset, 'abc'))
    expect(json.preset.primary).toBe(preset.primary)
    expect(json.themes.dark['--primary']).toBe(studio.dark.tokens['--primary'])
  })

  it('has a dictionary entry for every creator key', () => {
    const root = path.resolve(__dirname, '../../..')
    const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/en.json'), 'utf8')) as Record<string, string>
    const source = fs.readFileSync(path.join(root, 'src/components/create/ThemeCreator.tsx'), 'utf8')
    const keys = [...source.matchAll(/t\('(design\.[A-Za-z0-9.-]+)'\)/g)].map((match) => match[1])
    expect(keys.length).toBeGreaterThan(30)
    for (const key of keys) expect(dictionary[key]).toBeTruthy()
    for (const id of [...Object.keys(NAMED_PRESETS), 'custom']) expect(dictionary[`design.create.presets.${id}`]).toBeTruthy()
    for (const id of ['action', 'hover', 'body', 'muted', 'selection', 'focus']) expect(dictionary[`design.create.pairs.${id}`]).toBeTruthy()
  })
})
