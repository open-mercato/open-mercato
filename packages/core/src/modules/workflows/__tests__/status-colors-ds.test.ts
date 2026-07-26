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

const RAW_HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

const RAW_RGB_COLOR = /\brgba?\(/g

describe('workflows status colors — design-system tokens', () => {
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
