import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResolver, type PackageResolver } from '../../resolver'
import { readChecksumRecord } from '../../utils'
import { generateWebResearchAdapters, getWebResearchAdapterWatchInputs } from '../web-research-adapters'

function createTestResolver(root: string): PackageResolver {
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
    resolver = createTestResolver(root)
    outFile = path.join(resolver.getOutputDir(), 'web-research-adapters.generated.ts')
    checksumFile = path.join(resolver.getOutputDir(), 'web-research-adapters.checksum')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('shares candidate manifests and coarse recursive discovery roots with the watcher', async () => {
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
    expect(inputs.directoryPaths).toEqual([
      workspaceRoot, installedRoot, appInstalledRoot,
    ])
    expect(inputs.fullReasons).toEqual([])
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
    expect(nextInputs.directoryPaths).toEqual([workspaceRoot, installedRoot, appInstalledRoot])
    expect(nextInputs.fullReasons).toEqual([])
    await generateWebResearchAdapters({ resolver, quiet: true })
    expect(fs.readFileSync(outFile, 'utf8')).toContain("from '@another-vendor/adapter'")
  })

  it('keeps standalone discovery roots inside the standalone project', () => {
    const project = path.join(root, 'standalone')
    const installedAdapter = path.join(project, 'node_modules', '@example', 'adapter')
    writeManifest(installedAdapter, '@example/adapter', 'adapter')
    const standaloneResolver = createResolver(project)

    const inputs = getWebResearchAdapterWatchInputs(standaloneResolver)

    expect(inputs.directoryPaths).toEqual([
      path.join(project, 'packages'),
      path.join(project, 'node_modules'),
    ])
    expect(inputs.manifestPaths).toEqual([path.join(installedAdapter, 'package.json')])
    expect(inputs.fullReasons).toEqual([])
    expect(inputs.directoryPaths.every((directory) => {
      const relative = path.relative(project, directory)
      return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    })).toBe(true)
  })

  it('reports scan failures deterministically and generation writes nothing', async () => {
    const scanSpy = jest.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })

    const inputs = getWebResearchAdapterWatchInputs(resolver)
    const expectedReasons = [
      path.join(root, 'node_modules'),
      path.join(root, 'packages'),
      path.join(resolver.getAppDir(), 'node_modules'),
    ]
      .map((directory) => `Cannot scan web-research adapter packages: ${directory}`)
      .sort((left, right) => left.localeCompare(right))
    expect(inputs.fullReasons).toEqual(expectedReasons)
    await expect(generateWebResearchAdapters({ resolver, quiet: true }))
      .rejects.toThrow(expectedReasons.join('\n'))
    scanSpy.mockRestore()
    expect(fs.existsSync(outFile)).toBe(false)
    expect(fs.existsSync(checksumFile)).toBe(false)
  })

  it('treats non-missing manifest read failures as uncertain and writes nothing', async () => {
    writeManifest(path.join(root, 'packages', 'adapter'), '@example/adapter', 'adapter')
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })

    await expect(generateWebResearchAdapters({ resolver, quiet: true }))
      .rejects.toThrow(`Cannot read web-research adapter manifest: ${path.join(root, 'packages', 'adapter', 'package.json')}`)
    readSpy.mockRestore()
    expect(fs.existsSync(outFile)).toBe(false)
    expect(fs.existsSync(checksumFile)).toBe(false)
  })

  it('skips invalid JSON deterministically without treating it as I/O uncertainty', async () => {
    const invalidManifest = path.join(root, 'packages', 'invalid', 'package.json')
    fs.mkdirSync(path.dirname(invalidManifest), { recursive: true })
    fs.writeFileSync(invalidManifest, '{"name":"invalid",')

    expect(getWebResearchAdapterWatchInputs(resolver).fullReasons).toEqual([])
    const first = await generateWebResearchAdapters({ resolver, quiet: true })
    const content = fs.readFileSync(outFile, 'utf8')
    const second = await generateWebResearchAdapters({ resolver, quiet: true })

    expect(first.filesWritten).toEqual([outFile])
    expect(content).not.toContain("from 'invalid'")
    expect(second.filesWritten).toEqual([])
    expect(second.filesUnchanged).toEqual([outFile])
    expect(fs.readFileSync(outFile, 'utf8')).toBe(content)
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
