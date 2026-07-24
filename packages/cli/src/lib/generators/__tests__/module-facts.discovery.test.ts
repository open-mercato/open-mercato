import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../../resolver'
import { discoverPackageModuleSources, hasReadableModuleSource } from '../module-facts-discovery'

type FakePackage = { name: string; version?: string | null; path: string; modulesPath: string }

function makeResolver(packages: FakePackage[]): PackageResolver {
  return {
    discoverPackages: () => packages,
  } as unknown as PackageResolver
}

function writeModule(modulesDir: string, moduleId: string, file: string): void {
  const moduleRoot = path.join(modulesDir, moduleId)
  fs.mkdirSync(moduleRoot, { recursive: true })
  fs.writeFileSync(path.join(moduleRoot, file), '// fixture\n')
}

describe('module-facts discovery (T1)', () => {
  let tmp: string

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-discovery-'))
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('hasReadableModuleSource is true for a .ts module and false for a .js-only module', () => {
    const srcModules = path.join(tmp, 'readable', 'src', 'modules')
    writeModule(srcModules, 'alpha', 'index.ts')
    const distModules = path.join(tmp, 'readable', 'dist', 'modules')
    writeModule(distModules, 'compiled', 'index.js')

    expect(hasReadableModuleSource(path.join(srcModules, 'alpha'))).toBe(true)
    expect(hasReadableModuleSource(path.join(distModules, 'compiled'))).toBe(false)
    expect(hasReadableModuleSource(path.join(srcModules, 'missing'))).toBe(false)
  })

  it('returns package-provided .ts modules and skips .js-only installs (A1 + A3)', () => {
    const pkgSrc = path.join(tmp, 'pkg-a')
    writeModule(path.join(pkgSrc, 'src', 'modules'), 'alpha', 'index.ts')
    writeModule(path.join(pkgSrc, 'src', 'modules'), 'beta', 'acl.ts')

    const pkgDist = path.join(tmp, 'pkg-compiled')
    writeModule(path.join(pkgDist, 'dist', 'modules'), 'compiled', 'index.js')

    const resolver = makeResolver([
      { name: '@open-mercato/core', path: pkgSrc, modulesPath: path.join(pkgSrc, 'src', 'modules') },
      { name: '@open-mercato/compiled', path: pkgDist, modulesPath: path.join(pkgDist, 'dist', 'modules') },
    ])

    const ids = discoverPackageModuleSources(resolver).map((source) => source.moduleId)
    expect(ids.sort()).toEqual(['alpha', 'beta'])
  })

  it('tags each source with its providing package name', () => {
    const pkgSrc = path.join(tmp, 'pkg-tagged')
    writeModule(path.join(pkgSrc, 'src', 'modules'), 'gamma', 'events.ts')

    const resolver = makeResolver([
      { name: '@open-mercato/tagged', version: '0.6.6', path: pkgSrc, modulesPath: path.join(pkgSrc, 'src', 'modules') },
    ])

    const [source] = discoverPackageModuleSources(resolver)
    expect(source).toMatchObject({
      moduleId: 'gamma',
      from: '@open-mercato/tagged',
      packageVersion: '0.6.6',
    })
    expect(source.moduleRoot).toBe(path.join(pkgSrc, 'src', 'modules', 'gamma'))
  })

  it('dedupes duplicate module ids first-wins', () => {
    const pkgA = path.join(tmp, 'dup-a')
    writeModule(path.join(pkgA, 'src', 'modules'), 'shared', 'index.ts')
    const pkgB = path.join(tmp, 'dup-b')
    writeModule(path.join(pkgB, 'src', 'modules'), 'shared', 'index.ts')

    const resolver = makeResolver([
      { name: '@open-mercato/dup-a', path: pkgA, modulesPath: path.join(pkgA, 'src', 'modules') },
      { name: '@open-mercato/dup-b', path: pkgB, modulesPath: path.join(pkgB, 'src', 'modules') },
    ])

    const sources = discoverPackageModuleSources(resolver)
    expect(sources).toHaveLength(1)
    expect(sources[0].moduleRoot).toBe(path.join(pkgA, 'src', 'modules', 'shared'))
  })
})
