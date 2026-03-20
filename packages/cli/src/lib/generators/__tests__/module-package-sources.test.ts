import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateModulePackageSources } from '../module-package-sources'
import type { PackageResolver } from '../../resolver'

const fixturePackageRoot = path.resolve(
  __dirname,
  '..',
  '..',
  '__fixtures__',
  'official-module-package',
)

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function createResolver(tmpDir: string, packageRoot: string, from: string): PackageResolver {
  const appDir = path.join(tmpDir, 'app')
  const outputDir = path.join(appDir, '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })

  return {
    isMonorepo: () => false,
    getRootDir: () => appDir,
    getAppDir: () => appDir,
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(appDir, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => [{ id: 'test_package', from }],
    getModulePaths: () => ({
      appBase: path.join(appDir, 'src', 'modules', 'test_package'),
      pkgBase: path.join(packageRoot, 'src', 'modules', 'test_package'),
    }),
    getModuleImportBase: () => ({
      appBase: '@/modules/test_package',
      pkgBase: `${from}/modules/test_package`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => packageRoot,
  }
}

describe('generateModulePackageSources', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-package-sources-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes @source entries for official package-backed modules', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    copyDir(fixturePackageRoot, packageRoot)
    const resolver = createResolver(tmpDir, packageRoot, '@open-mercato/test-package')

    const result = await generateModulePackageSources({ resolver, quiet: true })
    expect(result.errors).toEqual([])

    const output = fs.readFileSync(path.join(resolver.getOutputDir(), 'module-package-sources.css'), 'utf8')
    expect(output).toContain('@source')
    expect(output).toContain('node_modules/@open-mercato/test-package/src/**/*.{ts,tsx}')
  })

  it('skips app-backed modules', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    copyDir(fixturePackageRoot, packageRoot)
    const resolver = createResolver(tmpDir, packageRoot, '@app')

    await generateModulePackageSources({ resolver, quiet: true })

    const output = fs.readFileSync(path.join(resolver.getOutputDir(), 'module-package-sources.css'), 'utf8')
    expect(output).toBe('')
  })

  it('resolves hoisted package-backed modules for monorepo apps', async () => {
    const appDir = path.join(tmpDir, 'apps', 'mercato')
    const outputDir = path.join(appDir, '.mercato', 'generated')
    const installedPackageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    copyDir(fixturePackageRoot, installedPackageRoot)
    fs.mkdirSync(outputDir, { recursive: true })

    const resolver = {
      isMonorepo: () => true,
      getRootDir: () => tmpDir,
      getAppDir: () => appDir,
      getOutputDir: () => outputDir,
      getModulesConfigPath: () => path.join(appDir, 'src', 'modules.ts'),
      discoverPackages: () => [],
      loadEnabledModules: () => [{ id: 'test_package', from: '@open-mercato/test-package' }],
      getModulePaths: () => ({
        appBase: path.join(appDir, 'src', 'modules', 'test_package'),
        pkgBase: path.join(installedPackageRoot, 'src', 'modules', 'test_package'),
      }),
      getModuleImportBase: () => ({
        appBase: '@/modules/test_package',
        pkgBase: '@open-mercato/test-package/modules/test_package',
      }),
      getPackageOutputDir: () => outputDir,
      getPackageRoot: () => installedPackageRoot,
    } as PackageResolver

    await generateModulePackageSources({ resolver, quiet: true })

    const output = fs.readFileSync(path.join(outputDir, 'module-package-sources.css'), 'utf8')
    expect(output).toContain('node_modules/@open-mercato/test-package/src/**/*.{ts,tsx}')
  })
})
