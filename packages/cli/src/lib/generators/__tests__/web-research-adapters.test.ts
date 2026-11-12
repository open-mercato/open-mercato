import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript-js'
import type { PackageResolver } from '../../resolver'
import { generateWebResearchAdapters } from '../web-research-adapters'

let tmpRoot: string
let appDir: string
let outputDir: string

function createMockResolver(): PackageResolver {
  return {
    getAppDir: () => appDir,
    getOutputDir: () => outputDir,
  } as unknown as PackageResolver
}

function writeAdapterPackage(
  packageDir: string,
  packageName: string,
  adapterId: string,
  source = `export const id = '${adapterId}'\n`,
): void {
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      type: 'module',
      exports: './index.js',
      openMercato: { webResearchAdapter: { id: adapterId } },
    }),
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), source)
}

function writeWorkspaceOnlyAdapter(directoryName: string, packageName: string, adapterId: string): void {
  writeAdapterPackage(path.join(tmpRoot, 'packages', directoryName), packageName, adapterId)
}

function writeInstalledAdapter(packageName: string, adapterId: string, source?: string): void {
  writeAdapterPackage(path.join(tmpRoot, 'node_modules', ...packageName.split('/')), packageName, adapterId, source)
}

async function generate(): Promise<string> {
  await generateWebResearchAdapters({ resolver: createMockResolver(), quiet: true })
  return fs.readFileSync(path.join(outputDir, 'web-research-adapters.generated.ts'), 'utf8')
}

function runGeneratedRegistry(content: string): { status: number | null; stdout: string; stderr: string } {
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const registryFile = path.join(outputDir, 'web-research-adapters.generated.mjs')
  fs.writeFileSync(registryFile, compiled)
  const script = [
    `const { webResearchAdapterEntries } = await import(${JSON.stringify(registryFile)})`,
    'console.log(JSON.stringify(webResearchAdapterEntries.map((entry) => [entry.packageName, entry.module.id])))',
  ].join('\n')
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: appDir,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr }
}

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'web-research-adapters-test-')))
  appDir = path.join(tmpRoot, 'apps', 'mercato')
  outputDir = path.join(appDir, '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('generateWebResearchAdapters', () => {
  it('emits an empty registry when no adapter package is discovered', async () => {
    const content = await generate()

    expect(content).toContain('export const webResearchAdapterEntries: AdapterRegistryEntry[] = []')
    expect(content).not.toMatch(/import\(/)
  })

  it('imports every discovered adapter with a literal specifier and no static import', async () => {
    writeInstalledAdapter('@acme/web-research-installed', 'installed')
    writeWorkspaceOnlyAdapter('web-research-workspace-only', '@acme/web-research-workspace-only', 'workspace-only')

    const content = await generate()

    expect(content).toContain("import('@acme/web-research-installed')")
    expect(content).toContain("import('@acme/web-research-workspace-only')")
    expect(content).not.toMatch(/^import \* as /m)
  })

  it('loads installed adapters and skips workspace packages the app cannot resolve', async () => {
    writeInstalledAdapter('@acme/web-research-installed', 'installed')
    writeWorkspaceOnlyAdapter('web-research-workspace-only', '@acme/web-research-workspace-only', 'workspace-only')

    const result = runGeneratedRegistry(await generate())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([['@acme/web-research-installed', 'installed']])
  })

  it('still surfaces an installed adapter that fails while loading', async () => {
    writeInstalledAdapter('@acme/web-research-broken', 'broken', "throw new Error('adapter exploded')\n")

    const result = runGeneratedRegistry(await generate())

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('adapter exploded')
  })

  it('still surfaces an installed adapter whose own dependency is missing', async () => {
    writeInstalledAdapter(
      '@acme/web-research-needs-dep',
      'needs-dep',
      "import '@acme/missing-adapter-dependency'\nexport const id = 'needs-dep'\n",
    )

    const result = runGeneratedRegistry(await generate())

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('@acme/missing-adapter-dependency')
  })

  it('still surfaces an installed adapter whose entry file is missing', async () => {
    writeInstalledAdapter('@acme/web-research-unbuilt', 'unbuilt')
    fs.rmSync(path.join(tmpRoot, 'node_modules', '@acme', 'web-research-unbuilt', 'index.js'))

    const result = runGeneratedRegistry(await generate())

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/Cannot find module/)
  })
})
