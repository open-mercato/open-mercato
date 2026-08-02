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
      static revision = 1

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
  dependencies: Record<string, string>
} {
  return JSON.parse(
    fs.readFileSync(
      path.join(appRoot, '.mercato', 'generated', `${baseName}.generated.mjs.cache.json`),
      'utf8',
    ),
  )
}

function loadBootstrapDataInNode(appRoot: string): {
  entityNames: string[]
  entityRevisions: number[]
} {
  const loaderUrl = pathToFileURL(path.resolve(__dirname, '../dynamicLoader.ts')).href
  const script = `
    import { loadBootstrapData } from ${JSON.stringify(loaderUrl)}
    const data = await loadBootstrapData(process.argv[1])
    process.stdout.write(JSON.stringify({
      entityNames: data.entities.map((entity) => entity.name),
      entityRevisions: data.entities.map((entity) => entity.revision),
    }))
  `
  return JSON.parse(execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, appRoot],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, OM_LOG_DESTINATION: 'stderr' },
    },
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

    expect(after.version).toBe(4)
    expect(after.inputHash).not.toBe(before.inputHash)
  })

  it('invalidates compiled output when only an extended tsconfig changes', async () => {
    const appRoot = createAppRoot()
    const appTsconfigPath = path.join(appRoot, 'tsconfig.json')
    const baseTsconfigPath = path.join(appRoot, 'tsconfig.base.json')
    fs.writeFileSync(baseTsconfigPath, JSON.stringify(LEGACY_TSCONFIG))
    fs.writeFileSync(appTsconfigPath, `{
      // The loader must follow JSONC extends references.
      "extends": "./tsconfig.base.json",
    }`)
    loadBootstrapDataInNode(appRoot)
    const before = readCacheMetadata(appRoot, 'entities')

    fs.writeFileSync(baseTsconfigPath, JSON.stringify({
      ...LEGACY_TSCONFIG,
      compilerOptions: {
        ...LEGACY_TSCONFIG.compilerOptions,
        useDefineForClassFields: true,
      },
    }))
    loadBootstrapDataInNode(appRoot)
    const after = readCacheMetadata(appRoot, 'entities')

    expect(after.inputHash).not.toBe(before.inputHash)
    expect(after.dependencies['tsconfig.base.json']).not.toBe(
      before.dependencies['tsconfig.base.json'],
    )
  })

  it('invalidates compiled output when a package-resolved tsconfig changes', async () => {
    const appRoot = createAppRoot()
    const configPackageRoot = path.join(appRoot, 'node_modules', 'probe-tsconfig')
    const packageTsconfigPath = path.join(configPackageRoot, 'tsconfig.json')
    fs.mkdirSync(configPackageRoot, { recursive: true })
    fs.writeFileSync(path.join(configPackageRoot, 'package.json'), JSON.stringify({
      name: 'probe-tsconfig',
      version: '1.0.0',
      main: 'tsconfig.json',
    }))
    fs.writeFileSync(packageTsconfigPath, JSON.stringify(LEGACY_TSCONFIG))
    fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), JSON.stringify({
      extends: 'probe-tsconfig',
    }))
    loadBootstrapDataInNode(appRoot)
    const before = readCacheMetadata(appRoot, 'entities')

    fs.writeFileSync(packageTsconfigPath, JSON.stringify({
      ...LEGACY_TSCONFIG,
      compilerOptions: {
        ...LEGACY_TSCONFIG.compilerOptions,
        useDefineForClassFields: true,
      },
    }))
    loadBootstrapDataInNode(appRoot)
    const after = readCacheMetadata(appRoot, 'entities')

    expect(after.inputHash).not.toBe(before.inputHash)
    expect(after.dependencies['node_modules/probe-tsconfig/tsconfig.json']).not.toBe(
      before.dependencies['node_modules/probe-tsconfig/tsconfig.json'],
    )
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

  it('excludes client-only virtual inputs from cache dependencies', async () => {
    const appRoot = createAppRoot()
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.writeFileSync(path.join(generatedDir, 'modules.cli.generated.ts'), `
      export const modules = [{ widget: () => import('./widget.client') }]
    `)

    loadBootstrapDataInNode(appRoot)

    const metadata = readCacheMetadata(appRoot, 'modules.cli')
    expect(Object.keys(metadata.dependencies)).not.toContain('om-client-only-stub:./widget.client')
    expect(
      fs.readFileSync(path.join(generatedDir, 'modules.cli.generated.mjs'), 'utf8'),
    ).toContain('clientOnlyModuleUnavailable')
  })

  it('invalidates compiled output when only a bundled local dependency changes', async () => {
    const appRoot = createAppRoot()
    const generatedSourcePath = path.join(
      appRoot,
      '.mercato',
      'generated',
      'entities.generated.ts',
    )
    const generatedSource = fs.readFileSync(generatedSourcePath, 'utf8')
    const first = loadBootstrapDataInNode(appRoot)
    const before = readCacheMetadata(appRoot, 'entities')
    const entityPath = path.join(appRoot, 'src', 'modules', 'probe', 'data', 'entities.ts')

    fs.writeFileSync(
      entityPath,
      fs.readFileSync(entityPath, 'utf8').replace('static revision = 1', 'static revision = 2'),
    )
    const second = loadBootstrapDataInNode(appRoot)
    const after = readCacheMetadata(appRoot, 'entities')

    expect(first.entityRevisions).toEqual([1])
    expect(second.entityRevisions).toEqual([2])
    expect(after.outputHash).not.toBe(before.outputHash)
    expect(after.dependencies['src/modules/probe/data/entities.ts']).not.toBe(
      before.dependencies['src/modules/probe/data/entities.ts'],
    )
    expect(fs.readFileSync(generatedSourcePath, 'utf8')).toBe(generatedSource)
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
    fs.writeFileSync(metadataPath, JSON.stringify({ ...stale, version: 2 }))

    loadBootstrapDataInNode(appRoot)

    expect(readCacheMetadata(appRoot, 'entities').version).toBe(4)
  })
})
