/**
 * @jest-environment node
 *
 * Regression guard for #4327: the CLI/queue-worker bootstrap path
 * (loadBootstrapData) must load command-interceptors.generated.ts and expose
 * `commandInterceptorEntries` in its BootstrapData. The interceptor registry is
 * per-process, so a worker that omits the field silently no-ops every command
 * interceptor while the Next.js runtime applies them — split behavior between
 * web and queued execution of the same command.
 *
 * The test authors both the generated .ts sources and fresh compiled .mjs
 * siblings, so compileAndImport takes its cache path and never invokes esbuild.
 * The .mjs stubs use module.exports because Jest's CJS runtime handles the
 * dynamic import() and does not transform .mjs files; the loader consumes the
 * named exports identically either way.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadBootstrapData } from '../dynamicLoader'

const GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
  'command-interceptors.generated': {
    ts: 'export const commandInterceptorEntries = []',
    compiled: `module.exports = { commandInterceptorEntries: [
      { moduleId: 'example', interceptors: [{ id: 'example.adjust-probability' }] },
    ] }`,
  },
}

const APP_TSCONFIG = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    useDefineForClassFields: false,
    target: 'ES2022',
  },
})

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function writeGeneratedModule(generatedDir: string, baseName: string, source: { ts: string; compiled: string }) {
  const sourcePath = path.join(generatedDir, `${baseName}.ts`)
  const compiledPath = path.join(generatedDir, `${baseName}.mjs`)
  fs.writeFileSync(sourcePath, source.ts)
  fs.writeFileSync(compiledPath, source.compiled)
  fs.writeFileSync(`${compiledPath}.cache.json`, JSON.stringify({
    version: 2,
    inputHash: hash(JSON.stringify({
      version: 2,
      sourceHash: hash(source.ts),
      tsconfigHash: hash(APP_TSCONFIG),
    })),
    outputHash: hash(source.compiled),
  }))
}

describe('loadBootstrapData — command interceptors reach worker/CLI bootstrap (#4327)', () => {
  let appRoot: string

  beforeAll(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4327-'))
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), APP_TSCONFIG)
    for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
      writeGeneratedModule(generatedDir, baseName, source)
    }
  })

  afterAll(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('returns commandInterceptorEntries from command-interceptors.generated', async () => {
    const data = await loadBootstrapData(appRoot)

    expect(data.commandInterceptorEntries).toEqual([
      { moduleId: 'example', interceptors: [{ id: 'example.adjust-probability' }] },
    ])
  })

  it('falls back to an empty array (not undefined) when the generated file is absent', async () => {
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.rmSync(path.join(generatedDir, 'command-interceptors.generated.ts'))
    fs.rmSync(path.join(generatedDir, 'command-interceptors.generated.mjs'))

    const data = await loadBootstrapData(appRoot)

    expect(data.commandInterceptorEntries).toEqual([])
    expect(data.commandLoaderEntries).toEqual([])
  })
})
