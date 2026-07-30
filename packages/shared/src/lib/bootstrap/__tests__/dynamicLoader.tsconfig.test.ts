/**
 * @jest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const LEGACY_TSCONFIG = {
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    useDefineForClassFields: false,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
  },
}

const GENERATED_MODULES: Record<string, string> = {
  'entities.ids.generated': 'export const E = {}',
  'modules.cli.generated': 'export const modules = []',
  'di.generated': 'export const diRegistrars = []',
  'entities.generated': `
    import { ProbeEntity } from '@/src/modules/probe/data/entities'
    export const entities = [ProbeEntity]
  `,
}

function writeFixture(): string {
  const appRoot = fs.mkdtempSync(path.join(process.cwd(), '.tmp-dynamic-loader-'))
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  const entityDir = path.join(appRoot, 'src', 'modules', 'probe', 'data')
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.mkdirSync(entityDir, { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), JSON.stringify(LEGACY_TSCONFIG))
  fs.writeFileSync(path.join(entityDir, 'entities.ts'), `
    import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'

    @Entity()
    export class ProbeEntity {
      @PrimaryKey()
      id!: string
    }
  `)
  for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
    fs.writeFileSync(path.join(generatedDir, `${baseName}.ts`), source)
  }
  return appRoot
}

function readCacheMetadata(appRoot: string, baseName: string): {
  version: number
  inputHash: string
  outputHash: string
} {
  return JSON.parse(
    fs.readFileSync(
      path.join(appRoot, '.mercato', 'generated', `${baseName}.generated.mjs.cache.json`),
      'utf8',
    ),
  )
}

function loadBootstrapDataInNode(appRoot: string): { entityNames: string[] } {
  const loaderUrl = pathToFileURL(path.resolve(__dirname, '../dynamicLoader.ts')).href
  const script = `
    import { loadBootstrapData } from ${JSON.stringify(loaderUrl)}
    const data = await loadBootstrapData(process.argv[1])
    process.stdout.write(JSON.stringify({
      entityNames: data.entities.map((entity) => entity.name),
    }))
  `
  return JSON.parse(execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, appRoot],
    { cwd: process.cwd(), encoding: 'utf8' },
  ))
}

describe('dynamic loader app tsconfig and content-addressed cache', () => {
  const appRoots: string[] = []

  afterAll(() => {
    for (const appRoot of appRoots) {
      fs.rmSync(appRoot, { recursive: true, force: true })
    }
  })

  function createAppRoot(): string {
    const appRoot = writeFixture()
    appRoots.push(appRoot)
    return appRoot
  }

  it('imports a real MikroORM legacy-decorated local entity', async () => {
    const appRoot = createAppRoot()

    const data = loadBootstrapDataInNode(appRoot)

    expect(data.entityNames).toEqual(['ProbeEntity'])
    const compiled = fs.readFileSync(
      path.join(appRoot, '.mercato', 'generated', 'entities.generated.mjs'),
      'utf8',
    )
    expect(compiled).toContain('__decorateClass')
    expect(compiled).not.toContain('__decorateElement')
  })

  it('invalidates compiled output when only app tsconfig content changes', async () => {
    const appRoot = createAppRoot()
    loadBootstrapDataInNode(appRoot)
    const before = readCacheMetadata(appRoot, 'entities')

    fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), JSON.stringify({
      ...LEGACY_TSCONFIG,
      compilerOptions: {
        ...LEGACY_TSCONFIG.compilerOptions,
        useDefineForClassFields: true,
      },
    }))
    loadBootstrapDataInNode(appRoot)
    const after = readCacheMetadata(appRoot, 'entities')

    expect(after.version).toBe(2)
    expect(after.inputHash).not.toBe(before.inputHash)
  })

  it('invalidates compiled output when generated source content changes', async () => {
    const appRoot = createAppRoot()
    loadBootstrapDataInNode(appRoot)
    const before = readCacheMetadata(appRoot, 'entities')
    const sourcePath = path.join(
      appRoot,
      '.mercato',
      'generated',
      'entities.generated.ts',
    )

    fs.appendFileSync(sourcePath, '\nexport const sourceRevision = 2\n')
    loadBootstrapDataInNode(appRoot)
    const after = readCacheMetadata(appRoot, 'entities')

    expect(after.inputHash).not.toBe(before.inputHash)
  })

  it('rebuilds a compiled file whose bytes do not match its sidecar', async () => {
    const appRoot = createAppRoot()
    loadBootstrapDataInNode(appRoot)
    const compiledPath = path.join(appRoot, '.mercato', 'generated', 'entities.generated.mjs')
    fs.writeFileSync(compiledPath, 'this is not valid JavaScript')

    const data = loadBootstrapDataInNode(appRoot)

    expect(data.entityNames).toEqual(['ProbeEntity'])
    expect(fs.readFileSync(compiledPath, 'utf8')).toContain('__decorateClass')
  })

  it('rebuilds a cache sidecar from an older loader format version', async () => {
    const appRoot = createAppRoot()
    loadBootstrapDataInNode(appRoot)
    const metadataPath = path.join(
      appRoot,
      '.mercato',
      'generated',
      'entities.generated.mjs.cache.json',
    )
    const stale = readCacheMetadata(appRoot, 'entities')
    fs.writeFileSync(metadataPath, JSON.stringify({ ...stale, version: 1 }))

    loadBootstrapDataInNode(appRoot)

    expect(readCacheMetadata(appRoot, 'entities').version).toBe(2)
  })
})
