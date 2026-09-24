import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../../resolver'
import { readChecksumRecord } from '../../utils'
import { generateWebResearchAdapters, getWebResearchAdapterWatchInputs } from '../web-research-adapters'

function createResolver(root: string): PackageResolver {
  const appDir = path.join(root, 'apps', 'mercato')
  const outputDir = path.join(appDir, '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
  return {
    isMonorepo: () => true,
    getRootDir: () => root,
    getAppDir: () => appDir,
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(appDir, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => [],
    getModulePaths: (entry) => ({
      appBase: path.join(appDir, 'src', 'modules', entry.id),
      pkgBase: path.join(root, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => root,
  }
}

function writeManifest(packageRoot: string, name: string, adapterId?: string): void {
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name,
    ...(adapterId === undefined ? {} : { openMercato: { webResearchAdapter: { id: adapterId } } }),
  }))
}

describe('generateWebResearchAdapters', () => {
  let root: string
  let resolver: PackageResolver
  let outFile: string
  let checksumFile: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-research-adapters-test-'))
    resolver = createResolver(root)
    outFile = path.join(resolver.getOutputDir(), 'web-research-adapters.generated.ts')
    checksumFile = path.join(resolver.getOutputDir(), 'web-research-adapters.checksum')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('shares all candidate manifests and shallow discovery roots with the watcher', async () => {
    const workspaceRoot = path.join(root, 'packages')
    const installedRoot = path.join(root, 'node_modules')
    const appInstalledRoot = path.join(resolver.getAppDir(), 'node_modules')
    const workspaceAdapter = path.join(workspaceRoot, 'adapter-only')
    const scopedAdapter = path.join(installedRoot, '@third-party', 'adapter')
    const missingManifestPackage = path.join(installedRoot, 'ordinary-package')
    writeManifest(workspaceAdapter, 'workspace-adapter', 'workspace')
    writeManifest(scopedAdapter, '@third-party/adapter', 'third-party')
    fs.mkdirSync(missingManifestPackage, { recursive: true })
    writeManifest(path.join(workspaceAdapter, 'nested'), 'nested-implementation', 'ignored')
    writeManifest(path.join(installedRoot, '.cache'), 'cached-adapter', 'ignored')
    writeManifest(path.join(installedRoot, '.bin'), 'bin-adapter', 'ignored')

    const inputs = getWebResearchAdapterWatchInputs(resolver)
    expect(inputs.manifestPaths.slice().sort()).toEqual([
      path.join(workspaceAdapter, 'package.json'),
      path.join(scopedAdapter, 'package.json'),
      path.join(missingManifestPackage, 'package.json'),
    ].sort())
    expect(inputs.directoryPaths.slice().sort()).toEqual([
      workspaceRoot, installedRoot, path.join(installedRoot, '@third-party'), appInstalledRoot,
    ].sort())
    await generateWebResearchAdapters({ resolver, quiet: true })
    const initialOutput = fs.readFileSync(outFile, 'utf8')
    expect(initialOutput).toContain("from '@third-party/adapter'")
    expect(initialOutput).toContain("from 'workspace-adapter'")
    expect(initialOutput).not.toContain('nested-implementation')
    expect(initialOutput).not.toContain('cached-adapter')
    expect(initialOutput).not.toContain('bin-adapter')

    const appAdapter = path.join(appInstalledRoot, '@another-vendor', 'adapter')
    writeManifest(appAdapter, '@another-vendor/adapter', 'app')
    const nextInputs = getWebResearchAdapterWatchInputs(resolver)
    expect(nextInputs.manifestPaths).toContain(path.join(appAdapter, 'package.json'))
    expect(nextInputs.directoryPaths).toContain(path.join(appInstalledRoot, '@another-vendor'))
    await generateWebResearchAdapters({ resolver, quiet: true })
    expect(fs.readFileSync(outFile, 'utf8')).toContain("from '@another-vendor/adapter'")
  })

  it('preserves output and checksum bytes and mtimes after unrelated implementation changes', async () => {
    const packageRoot = path.join(root, 'packages', 'adapter')
    writeManifest(packageRoot, '@example/adapter', 'adapter')
    const implementationFile = path.join(packageRoot, 'index.ts')
    fs.writeFileSync(implementationFile, 'export const adapter = 1\n')
    await generateWebResearchAdapters({ resolver, quiet: true })
    const outputBefore = fs.readFileSync(outFile, 'utf8')
    const checksumBefore = fs.readFileSync(checksumFile, 'utf8')
    const pinnedTime = new Date(Date.now() - 60_000)
    fs.utimesSync(outFile, pinnedTime, pinnedTime)
    fs.utimesSync(checksumFile, pinnedTime, pinnedTime)
    const outputMtimeBefore = fs.statSync(outFile).mtimeMs
    const checksumMtimeBefore = fs.statSync(checksumFile).mtimeMs

    fs.writeFileSync(implementationFile, 'export const adapter = 200\n')
    fs.mkdirSync(path.join(packageRoot, 'dist', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'dist', 'nested', 'index.js'), 'export const adapter = 200\n')
    const result = await generateWebResearchAdapters({ resolver, quiet: true })

    expect(result.filesWritten).toEqual([])
    expect(result.filesUnchanged).toEqual([outFile])
    expect(fs.readFileSync(outFile, 'utf8')).toBe(outputBefore)
    expect(fs.readFileSync(checksumFile, 'utf8')).toBe(checksumBefore)
    expect(fs.statSync(outFile).mtimeMs).toBe(outputMtimeBefore)
    expect(fs.statSync(checksumFile).mtimeMs).toBe(checksumMtimeBefore)
  })

  it('discovers newly declared adapters and removes deleted or no-longer-valid declarations', async () => {
    const workspacePackage = path.join(root, 'packages', 'z-adapter')
    const installedPackage = path.join(root, 'node_modules', '@example', 'a-adapter')
    writeManifest(workspacePackage, '@example/z-adapter', 'z')
    writeManifest(installedPackage, '@example/a-adapter')
    await generateWebResearchAdapters({ resolver, quiet: true })
    const initialStructure = readChecksumRecord(checksumFile)?.structure
    const initialOutput = fs.readFileSync(outFile, 'utf8')
    expect(initialOutput).toContain("import * as adapter0 from '@example/z-adapter'")
    expect(initialOutput).not.toContain('@example/a-adapter')

    writeManifest(installedPackage, '@example/a-adapter', 'a')
    const added = await generateWebResearchAdapters({ resolver, quiet: true })
    const addedStructure = readChecksumRecord(checksumFile)?.structure
    expect(added.filesWritten).toEqual([outFile])
    expect(addedStructure).not.toBe(initialStructure)
    const addedOutput = fs.readFileSync(outFile, 'utf8')
    expect(addedOutput).toContain("import * as adapter0 from '@example/a-adapter'")
    expect(addedOutput).toContain("import * as adapter1 from '@example/z-adapter'")
    expect(addedOutput).toContain("{ packageName: '@example/a-adapter', module: adapter0 }")
    expect(addedOutput).toContain("{ packageName: '@example/z-adapter', module: adapter1 }")

    fs.rmSync(path.join(installedPackage, 'package.json'))
    await generateWebResearchAdapters({ resolver, quiet: true })
    expect(fs.readFileSync(outFile, 'utf8')).toBe(initialOutput)
    expect(readChecksumRecord(checksumFile)?.structure).toBe(initialStructure)

    writeManifest(workspacePackage, '@example/z-adapter', '')
    const removed = await generateWebResearchAdapters({ resolver, quiet: true })
    expect(removed.filesWritten).toEqual([outFile])
    expect(fs.readFileSync(outFile, 'utf8')).not.toContain('@example/z-adapter')
    expect(readChecksumRecord(checksumFile)?.structure).not.toBe(initialStructure)
  })

  it('tracks selected manifest identity and package precedence without rewriting identical imports', async () => {
    const workspacePackage = path.join(root, 'packages', 'adapter')
    const installedPackage = path.join(resolver.getAppDir(), 'node_modules', '@example', 'adapter')
    writeManifest(workspacePackage, '@example/adapter', 'workspace')
    writeManifest(installedPackage, '@example/adapter', 'installed')
    await generateWebResearchAdapters({ resolver, quiet: true })
    const outputBefore = fs.readFileSync(outFile, 'utf8')
    const initialStructure = readChecksumRecord(checksumFile)?.structure
    const pinnedTime = new Date(Date.now() - 60_000)
    fs.utimesSync(outFile, pinnedTime, pinnedTime)
    const outputMtimeBefore = fs.statSync(outFile).mtimeMs

    writeManifest(installedPackage, '@example/adapter', 'shadowed')
    await generateWebResearchAdapters({ resolver, quiet: true })
    expect(readChecksumRecord(checksumFile)?.structure).toBe(initialStructure)

    writeManifest(workspacePackage, '@example/adapter', 'workspace-updated')
    await generateWebResearchAdapters({ resolver, quiet: true })
    const changedStructure = readChecksumRecord(checksumFile)?.structure
    expect(changedStructure).not.toBe(initialStructure)

    fs.rmSync(workspacePackage, { recursive: true })
    const result = await generateWebResearchAdapters({ resolver, quiet: true })
    expect(readChecksumRecord(checksumFile)?.structure).not.toBe(changedStructure)
    expect(result.filesWritten).toEqual([])
    expect(result.filesUnchanged).toEqual([outFile])
    expect(fs.readFileSync(outFile, 'utf8')).toBe(outputBefore)
    expect(fs.statSync(outFile).mtimeMs).toBe(outputMtimeBefore)
  })
})
