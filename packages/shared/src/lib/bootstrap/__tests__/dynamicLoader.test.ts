import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const generatedExports: Record<string, string> = {
  // Jest evaluates file-URL imports through its CommonJS runtime in this suite.
  'entities.ids.generated.mjs': 'exports.E = {}\n',
  'modules.cli.generated.mjs': 'exports.modules = []\n',
  'entities.generated.mjs': 'exports.entities = []\n',
  'di.generated.mjs': 'exports.diRegistrars = []\n',
  'search.generated.mjs': 'exports.searchModuleConfigs = []\n',
  'command-loaders.generated.mjs': 'exports.commandLoaderEntries = []\n',
}

const mockBuild = jest.fn(async ({ outfile }: { outfile: string }) => {
  const output = generatedExports[path.basename(outfile)]
  if (!output) throw new Error(`Unexpected generated output: ${outfile}`)
  fs.writeFileSync(outfile, output)
})
const mockStop = jest.fn()

jest.mock('esbuild', () => ({
  build: mockBuild,
  stop: mockStop,
}))

import { loadBootstrapData } from '../dynamicLoader'

const generatedNames = [
  'entities.ids.generated.ts',
  'modules.cli.generated.ts',
  'entities.generated.ts',
  'di.generated.ts',
  'search.generated.ts',
  'command-loaders.generated.ts',
]

function createGeneratedApp(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const generatedDir = path.join(root, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  for (const name of generatedNames) {
    fs.writeFileSync(path.join(generatedDir, name), '// generated test input\n')
  }
  return root
}

describe('loadBootstrapData esbuild lifecycle', () => {
  let appRoot: string

  beforeEach(() => {
    appRoot = createGeneratedApp('open-mercato-dynamic-loader-')
    mockBuild.mockClear()
    mockStop.mockClear()
  })

  afterEach(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('stops esbuild after compilation and starts it again for a later changed load', async () => {
    await loadBootstrapData(appRoot)

    expect(mockBuild).toHaveBeenCalledTimes(generatedNames.length)
    expect(mockStop).toHaveBeenCalledTimes(1)

    const entityIdsPath = path.join(appRoot, '.mercato', 'generated', 'entities.ids.generated.ts')
    const future = new Date(Date.now() + 1000)
    fs.utimesSync(entityIdsPath, future, future)

    await loadBootstrapData(appRoot)

    expect(mockBuild).toHaveBeenCalledTimes(generatedNames.length + 1)
    expect(mockStop).toHaveBeenCalledTimes(2)
  })

  it('waits for concurrent bootstrap loads before stopping the shared service', async () => {
    const secondAppRoot = createGeneratedApp('open-mercato-dynamic-loader-concurrent-')

    try {
      await Promise.all([
        loadBootstrapData(appRoot),
        loadBootstrapData(secondAppRoot),
      ])

      expect(mockBuild).toHaveBeenCalledTimes(generatedNames.length * 2)
      expect(mockStop).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(secondAppRoot, { recursive: true, force: true })
    }
  })
})
