import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { discoverEnabledModuleSources, hasReadableModuleSource } from '../module-facts-discovery'

type ModulePaths = Record<string, { appBase: string; pkgBase: string }>

function makeResolver(options: {
  isMonorepo: boolean
  entries: ModuleEntry[]
  paths: ModulePaths
}): PackageResolver {
  return {
    isMonorepo: () => options.isMonorepo,
    loadEnabledModules: () => options.entries,
    getModulePaths: (entry: ModuleEntry) => options.paths[entry.id] ?? { appBase: '', pkgBase: '' },
  } as unknown as PackageResolver
}

function writeModule(root: string, moduleId: string, file: string): string {
  const moduleRoot = path.join(root, moduleId)
  fs.mkdirSync(moduleRoot, { recursive: true })
  fs.writeFileSync(path.join(moduleRoot, file), '// fixture\n')
  return moduleRoot
}

describe('module-facts discovery (T1)', () => {
  let tmp: string
  let pkgRoot: string
  let appRoot: string

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-discovery-'))
    pkgRoot = path.join(tmp, 'pkg')
    appRoot = path.join(tmp, 'app')
    writeModule(pkgRoot, 'alpha', 'index.ts')
    writeModule(pkgRoot, 'beta', 'acl.ts')
    writeModule(pkgRoot, 'compiled', 'index.js') // .js-only → skipped (A3)
    writeModule(appRoot, 'appmod', 'events.ts')
    writeModule(appRoot, 'alpha', 'index.ts') // app override of the pkg `alpha` (A2)
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('hasReadableModuleSource is true for a .ts module and false for a .js-only module', () => {
    expect(hasReadableModuleSource(path.join(pkgRoot, 'alpha'))).toBe(true)
    expect(hasReadableModuleSource(path.join(pkgRoot, 'compiled'))).toBe(false)
    expect(hasReadableModuleSource(path.join(pkgRoot, 'missing'))).toBe(false)
  })

  it('returns the enabled set and skips .js-only roots (A1 + A3)', () => {
    const resolver = makeResolver({
      isMonorepo: true,
      entries: [
        { id: 'alpha', from: '@open-mercato/core' },
        { id: 'beta', from: '@open-mercato/core' },
        { id: 'compiled', from: '@open-mercato/core' },
      ],
      paths: {
        alpha: { appBase: path.join(appRoot, 'missing'), pkgBase: path.join(pkgRoot, 'alpha') },
        beta: { appBase: path.join(appRoot, 'missing'), pkgBase: path.join(pkgRoot, 'beta') },
        compiled: { appBase: path.join(appRoot, 'missing'), pkgBase: path.join(pkgRoot, 'compiled') },
      },
    })
    const ids = discoverEnabledModuleSources(resolver).map((source) => source.moduleId)
    expect(ids.sort()).toEqual(['alpha', 'beta'])
  })

  it('prefers the app override directory over the package copy (A2)', () => {
    const resolver = makeResolver({
      isMonorepo: false,
      entries: [{ id: 'alpha', from: '@open-mercato/core' }],
      paths: { alpha: { appBase: path.join(appRoot, 'alpha'), pkgBase: path.join(pkgRoot, 'alpha') } },
    })
    const [source] = discoverEnabledModuleSources(resolver)
    expect(source.moduleRoot).toBe(path.join(appRoot, 'alpha'))
  })

  it('excludes @app modules in monorepo mode but includes them standalone (A6)', () => {
    const entries: ModuleEntry[] = [
      { id: 'alpha', from: '@open-mercato/core' },
      { id: 'appmod', from: '@app' },
    ]
    const paths: ModulePaths = {
      alpha: { appBase: path.join(appRoot, 'missing'), pkgBase: path.join(pkgRoot, 'alpha') },
      appmod: { appBase: path.join(appRoot, 'appmod'), pkgBase: path.join(pkgRoot, 'missing') },
    }

    const monorepoIds = discoverEnabledModuleSources(makeResolver({ isMonorepo: true, entries, paths })).map((s) => s.moduleId)
    expect(monorepoIds).toEqual(['alpha'])

    const standaloneIds = discoverEnabledModuleSources(makeResolver({ isMonorepo: false, entries, paths })).map((s) => s.moduleId)
    expect(standaloneIds.sort()).toEqual(['alpha', 'appmod'])
  })

  it('dedupes duplicate module ids first-wins', () => {
    const resolver = makeResolver({
      isMonorepo: false,
      entries: [
        { id: 'alpha', from: '@app' },
        { id: 'alpha', from: '@open-mercato/core' },
      ],
      paths: { alpha: { appBase: path.join(appRoot, 'alpha'), pkgBase: path.join(pkgRoot, 'alpha') } },
    })
    const sources = discoverEnabledModuleSources(resolver)
    expect(sources).toHaveLength(1)
    expect(sources[0].moduleRoot).toBe(path.join(appRoot, 'alpha'))
  })
})
