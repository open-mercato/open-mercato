import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateModulePackageSources } from '../module-package-sources'
import type { PackageResolver } from '../../resolver'
import { readChecksumRecord } from '../../utils'

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

function createResolver(tmpDir: string, packageRoot: string, from: string, moduleId = 'test_package'): PackageResolver {
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
    loadEnabledModules: () => [{ id: moduleId, from }],
    getModulePaths: () => ({
      appBase: path.join(appDir, 'src', 'modules', moduleId),
      pkgBase: path.join(packageRoot, 'src', 'modules', moduleId),
    }),
    getModuleImportBase: () => ({
      appBase: `@/modules/${moduleId}`,
      pkgBase: `${from}/modules/${moduleId}`,
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

  it('does not checksum unrelated files below the installed package root', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    copyDir(fixturePackageRoot, packageRoot)
    const resolver = createResolver(tmpDir, packageRoot, '@open-mercato/test-package')
    const outFile = path.join(resolver.getOutputDir(), 'module-package-sources.css')
    const checksumFile = path.join(resolver.getOutputDir(), 'module-package-sources.checksum')

    await generateModulePackageSources({ resolver, quiet: true })
    const outputBefore = fs.readFileSync(outFile, 'utf8')
    const checksumBefore = readChecksumRecord(checksumFile)
    const pinnedTime = new Date(Date.now() - 60_000)
    fs.utimesSync(outFile, pinnedTime, pinnedTime)
    fs.utimesSync(checksumFile, pinnedTime, pinnedTime)
    const outputMtimeBefore = fs.statSync(outFile).mtimeMs
    const checksumMtimeBefore = fs.statSync(checksumFile).mtimeMs

    fs.writeFileSync(path.join(packageRoot, 'src', 'unrelated-runtime.ts'), 'export const unrelated = true\n')
    const result = await generateModulePackageSources({ resolver, quiet: true })

    expect(result.filesWritten).toEqual([])
    expect(result.filesUnchanged).toEqual([outFile])
    expect(fs.readFileSync(outFile, 'utf8')).toBe(outputBefore)
    expect(fs.statSync(outFile).mtimeMs).toBe(outputMtimeBefore)
    expect(fs.statSync(checksumFile).mtimeMs).toBe(checksumMtimeBefore)
    expect(readChecksumRecord(checksumFile)).toEqual(checksumBefore)
  })

  it('tracks enabled module and package manifest inputs without touching byte-identical output', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    copyDir(fixturePackageRoot, packageRoot)
    copyDir(
      path.join(packageRoot, 'src', 'modules', 'test_package'),
      path.join(packageRoot, 'src', 'modules', 'alternate_module'),
    )
    copyDir(
      path.join(packageRoot, 'dist', 'modules', 'test_package'),
      path.join(packageRoot, 'dist', 'modules', 'alternate_module'),
    )
    const packageName = '@open-mercato/test-package'
    const initialResolver = createResolver(tmpDir, packageRoot, packageName)
    const alternateResolver = createResolver(tmpDir, packageRoot, packageName, 'alternate_module')
    const outFile = path.join(initialResolver.getOutputDir(), 'module-package-sources.css')
    const checksumFile = path.join(initialResolver.getOutputDir(), 'module-package-sources.checksum')

    await generateModulePackageSources({ resolver: initialResolver, quiet: true })
    const outputBefore = fs.readFileSync(outFile, 'utf8')
    const initialStructure = readChecksumRecord(checksumFile)?.structure
    const pinnedTime = new Date(Date.now() - 60_000)
    fs.utimesSync(outFile, pinnedTime, pinnedTime)
    const outputMtimeBefore = fs.statSync(outFile).mtimeMs

    await generateModulePackageSources({ resolver: alternateResolver, quiet: true })
    const alternateStructure = readChecksumRecord(checksumFile)?.structure
    expect(alternateStructure).not.toBe(initialStructure)
    expect(fs.readFileSync(outFile, 'utf8')).toBe(outputBefore)
    expect(fs.statSync(outFile).mtimeMs).toBe(outputMtimeBefore)

    const packageJsonPath = path.join(packageRoot, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
    packageJson.version = '0.2.0'
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const result = await generateModulePackageSources({ resolver: alternateResolver, quiet: true })

    expect(readChecksumRecord(checksumFile)?.structure).not.toBe(alternateStructure)
    expect(result.filesWritten).toEqual([])
    expect(result.filesUnchanged).toEqual([outFile])
    expect(fs.readFileSync(outFile, 'utf8')).toBe(outputBefore)
    expect(fs.statSync(outFile).mtimeMs).toBe(outputMtimeBefore)
  })

  it('keeps official package validation as the source inclusion gate', async () => {
    const packageRoot = path.join(tmpDir, 'node_modules', '@open-mercato', 'test-package')
    copyDir(fixturePackageRoot, packageRoot)
    const packageJsonPath = path.join(packageRoot, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
    packageJson.name = '@open-mercato/different-package'
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const resolver = createResolver(tmpDir, packageRoot, '@open-mercato/test-package')

    await generateModulePackageSources({ resolver, quiet: true })

    const output = fs.readFileSync(path.join(resolver.getOutputDir(), 'module-package-sources.css'), 'utf8')
    expect(output).toBe('')
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
