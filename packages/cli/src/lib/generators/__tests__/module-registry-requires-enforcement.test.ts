/**
 * `metadata.requires` must actually block `yarn generate` when the required module is
 * not enabled — it is not advisory text.
 *
 * The CLI package is built as an ES module (`packages/cli/package.json` `"type": "module"`),
 * where the bare `require()` this check used to read `metadata.requires` is undefined and
 * throws a `ReferenceError` on every module, every time. That throw was swallowed by a
 * `catch {}`, so the dependency map stayed empty and the check below it never found
 * anything to report: a module could declare `requires: ['catalog']`, `catalog` could be
 * disabled, and `yarn generate` would still succeed. Unit tests missed this because Jest
 * runs the generator under CommonJS, where `require()` is defined and the bug cannot
 * reproduce.
 *
 * The fix reads `metadata.requires` through `loadModuleExportsFromSource` (a real
 * `import()`) with an AST-based static fallback — the same mechanism this file already
 * uses for route metadata — so there is no `require()` left to break under ESM. This test
 * drives the real generator against real fixture files on disk rather than asserting on
 * the implementation, so it fails again if a future change reintroduces `require()`.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry } from '../module-registry'

let tmpDir: string
let outputDir: string

function touchFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function pkgModulePath(modId: string, ...segments: string[]): string {
  return path.join(tmpDir, 'packages', 'core', 'src', 'modules', modId, ...segments)
}

function createMockResolver(enabled: ModuleEntry[]): PackageResolver {
  return {
    isMonorepo: () => true,
    getRootDir: () => tmpDir,
    getAppDir: () => path.join(tmpDir, 'app'),
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpDir, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
      pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'packages', 'core'),
  } as unknown as PackageResolver
}

function scaffoldDependentFixture(): void {
  touchFile(pkgModulePath('leaf', 'index.ts'), "export const metadata = { id: 'leaf', label: 'Leaf' }\n")
  touchFile(
    pkgModulePath('dependent', 'index.ts'),
    "export const metadata = { id: 'dependent', label: 'Dependent', requires: ['leaf'] }\n",
  )
}

function mockProcessExit(): jest.SpyInstance {
  return jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`)
  }) as unknown as typeof process.exit)
}

describe('module registry enforces metadata.requires', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-requires-'))
    outputDir = path.join(tmpDir, 'app', '.mercato', 'generated')
    fs.mkdirSync(outputDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('refuses generation when a declared dependency is not enabled', async () => {
    scaffoldDependentFixture()
    const resolver = createMockResolver([{ id: 'dependent', from: '@open-mercato/core' }])
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const exitSpy = mockProcessExit()

    await expect(generateModuleRegistry({ resolver, quiet: true })).rejects.toThrow('process.exit(1)')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleErrorSpy.mock.calls.flat().join('\n')).toContain('Module "dependent" requires: leaf')

    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('generates cleanly once the declared dependency is enabled', async () => {
    scaffoldDependentFixture()
    const resolver = createMockResolver([
      { id: 'leaf', from: '@open-mercato/core' },
      { id: 'dependent', from: '@open-mercato/core' },
    ])
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const exitSpy = mockProcessExit()

    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    expect(exitSpy).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

describe('module registry has no require() left to break under the ESM CLI build', () => {
  it('reads metadata.requires without the CommonJS require() function', () => {
    // Jest runs this generator under CommonJS, where `require()` is defined — the two
    // tests above would pass even against the old, ESM-broken implementation. This
    // static check is what actually guards against a regression: `@open-mercato/cli`
    // is built as an ES module, so a bare `require()` call reintroduced here would throw
    // under the real build regardless of what Jest reports.
    const sourceFile = path.join(__dirname, '..', 'module-registry.ts')
    const source = fs.readFileSync(sourceFile, 'utf8')
    expect([...source.matchAll(/\brequire\(/g)]).toEqual([])
  })
})
