import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const moduleRoot = join(__dirname, '..')

const nodeFiles = readdirSync(join(moduleRoot, 'components/nodes'))
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => `components/nodes/${file}`)

const guardedFiles = [
  'lib/status-colors.ts',
  'backend/instances/[id]/page.tsx',
  'components/WorkflowNodeCard.tsx',
  'components/WorkflowGraphImpl.tsx',
  ...nodeFiles,
]

const runViewFiles = readdirSync(join(moduleRoot, 'components/run'))
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => `components/run/${file}`)

/**
 * A hex literal was never the only way to hardcode a colour here. Both instance
 * pages shipped `bg-blue-100 text-blue-800` status badges and an
 * `border-orange-300 bg-orange-50` compensation card that the hex-only guard
 * happily passed, so the run surfaces get a palette-shade check too.
 */
const paletteShadeGuardedFiles = [
  'backend/instances/[id]/page.tsx',
  'backend/instances/page.tsx',
  ...runViewFiles,
]

const RAW_HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

const RAW_RGB_COLOR = /\brgba?\(/g

const TAILWIND_PALETTE_SHADE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g

describe('workflows status colors — design-system tokens', () => {
  it.each(paletteShadeGuardedFiles)('%s uses status tokens, never raw Tailwind palette shades', (relativePath) => {
    const source = readFileSync(join(moduleRoot, relativePath), 'utf8')
    const matches = source.match(TAILWIND_PALETTE_SHADE) ?? []
    expect(matches).toEqual([])
  })

  it.each(guardedFiles)('%s contains no raw hex color literals', (relativePath) => {
    const source = readFileSync(join(moduleRoot, relativePath), 'utf8')
    const matches = source.match(RAW_HEX_COLOR) ?? []
    expect(matches).toEqual([])
  })

  it.each(['lib/status-colors.ts', 'backend/instances/[id]/page.tsx'])(
    '%s contains no raw rgb()/rgba() color literals',
    (relativePath) => {
      const source = readFileSync(join(moduleRoot, relativePath), 'utf8')
      const matches = source.match(RAW_RGB_COLOR) ?? []
      expect(matches).toEqual([])
    },
  )
})
