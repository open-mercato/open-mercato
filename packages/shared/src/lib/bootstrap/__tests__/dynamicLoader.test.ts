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
  // compileAndImport records the bundle's inputs in its cache metadata, so the
  // double has to supply a metafile the way a real esbuild build does.
  return { metafile: { inputs: {} } }
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
  // compileAndImport resolves the app tsconfig and folds it into the compile
  // cache key, so a generated app without one is not loadable.
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' } }),
  )
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

    // The compile cache keys off source content, not mtime, so the change that
    // forces a recompile has to be a real content change.
    const entityIdsPath = path.join(appRoot, '.mercato', 'generated', 'entities.ids.generated.ts')
    fs.writeFileSync(entityIdsPath, '// generated test input (changed)\n')

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
