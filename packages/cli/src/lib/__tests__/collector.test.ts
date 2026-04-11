import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../resolver'
import type { ModuleImports, ModuleRoots, ResolvedFile } from '../generators/scanner'
import { resolveModuleFile } from '../generators/scanner'
import { collectUmesData } from '../umes/collector'

jest.mock('../generators/scanner', () => ({
  resolveModuleFile: jest.fn(),
}))

const mockResolveModuleFile = jest.mocked(resolveModuleFile)

type MockModuleConfig = {
  entry: ModuleEntry
  roots: ModuleRoots
  imports: ModuleImports
}

function buildResolver(modules: MockModuleConfig[]): PackageResolver {
  const modulesById = new Map(modules.map((module) => [module.entry.id, module]))

  return {
    isMonorepo: () => true,
    getRootDir: () => '/repo',
    getAppDir: () => '/repo/apps/mercato',
    getOutputDir: () => '/repo/apps/mercato/.mercato/generated',
    getModulesConfigPath: () => '/repo/apps/mercato/src/modules.ts',
    discoverPackages: () => [],
    loadEnabledModules: () => modules.map((module) => module.entry),
    getModulePaths: (entry) => modulesById.get(entry.id)!.roots,
    getModuleImportBase: (entry) => modulesById.get(entry.id)!.imports,
    getPackageOutputDir: () => '/repo/generated',
    getPackageRoot: () => '/repo',
  }
}

function writeJsModule(tmpDir: string, relativePath: string, content: string): ResolvedFile {
  const absolutePath = path.join(tmpDir, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
  return {
    absolutePath,
    fromApp: false,
    importPath: absolutePath,
  }
}

describe('collectUmesData', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umes-collector-test-'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('collects declared features and extensions from module exports', () => {
    const moduleConfig: MockModuleConfig = {
      entry: { id: 'alpha', from: '@app' },
      roots: {
        appBase: path.join(tmpDir, 'app', 'alpha'),
        pkgBase: path.join(tmpDir, 'pkg', 'alpha'),
      },
      imports: {
        appBase: '@/modules/alpha',
        pkgBase: '@open-mercato/core/modules/alpha',
      },
    }

    const files = new Map<string, ResolvedFile>([
      [
        'acl.ts',
        writeJsModule(
          tmpDir,
          'alpha/acl.js',
          "module.exports.default = ['alpha.view', { id: 'alpha.edit' }, { label: 'ignored' }, null]\n",
        ),
      ],
      [
        'data/enrichers.ts',
        writeJsModule(
          tmpDir,
          'alpha/data/enrichers.js',
          [
            'module.exports.enrichers = [',
            "  { id: 'alpha.profile', targetEntity: 'customers', priority: 8, features: ['alpha.view'], timeout: 250, critical: true, cache: { ttl: 30 }, queryEngine: { enabled: true } },",
            "  { id: 'alpha.fallback' },",
            "  { targetEntity: 'ignored' },",
            ']',
          ].join('\n'),
        ),
      ],
      [
        'api/interceptors.ts',
        writeJsModule(
          tmpDir,
          'alpha/api/interceptors.js',
          [
            'module.exports.default = [',
            "  { id: 'alpha.guard', targetRoute: '/api/customers', methods: ['GET', 'PATCH'], priority: 4, features: ['alpha.edit'], before: () => true },",
            "  { id: 'alpha.audit', targetRoute: '/api/orders', methods: ['POST'], after: () => true },",
            "  { targetRoute: '/api/ignored' },",
            ']',
          ].join('\n'),
        ),
      ],
      [
        'widgets/components.ts',
        writeJsModule(
          tmpDir,
          'alpha/widgets/components.js',
          [
            'module.exports.componentOverrides = [',
            "  { target: { componentId: 'page:customers' }, wrapper: () => null, priority: 7, features: ['alpha.view'] },",
            "  { target: { componentId: 'page:orders' }, replacement: () => null },",
            "  { target: { componentId: 'page:products' }, propsTransform: () => ({}) },",
            '  { wrapper: () => null },',
            ']',
          ].join('\n'),
        ),
      ],
      [
        'widgets/injection-table.ts',
        writeJsModule(
          tmpDir,
          'alpha/widgets/injection-table.js',
          [
            'module.exports.default = {',
            "  'crud-form:customers:fields': ['alpha.simple', { widgetId: 'alpha.priority', priority: 9 }, { priority: 3 }],",
            "  'page:customers:sidebar': { widgetId: 'alpha.sidebar', priority: 2 },",
            '}',
          ].join('\n'),
        ),
      ],
    ])

    mockResolveModuleFile.mockImplementation((roots, _imps, relativePath) => {
      expect(roots).toEqual(moduleConfig.roots)
      return files.get(relativePath) ?? null
    })

    expect(collectUmesData(buildResolver([moduleConfig]))).toEqual([
      {
        moduleId: 'alpha',
        declaredFeatures: ['alpha.view', 'alpha.edit'],
        extensions: [
          {
            moduleId: 'alpha',
            type: 'enricher',
            id: 'alpha.profile',
            target: 'customers',
            priority: 8,
            features: ['alpha.view'],
            details: {
              timeout: 250,
              critical: true,
              hasCache: true,
              hasQueryEngine: true,
            },
          },
          {
            moduleId: 'alpha',
            type: 'enricher',
            id: 'alpha.fallback',
            target: '*',
            priority: 0,
            details: {
              timeout: undefined,
              critical: undefined,
              hasCache: false,
              hasQueryEngine: false,
            },
          },
          {
            moduleId: 'alpha',
            type: 'interceptor',
            id: 'alpha.guard',
            target: 'GET,PATCH /api/customers',
            priority: 4,
            features: ['alpha.edit'],
            details: {
              targetRoute: '/api/customers',
              methods: ['GET', 'PATCH'],
              hasBefore: true,
              hasAfter: false,
            },
          },
          {
            moduleId: 'alpha',
            type: 'interceptor',
            id: 'alpha.audit',
            target: 'POST /api/orders',
            priority: 0,
            details: {
              targetRoute: '/api/orders',
              methods: ['POST'],
              hasBefore: false,
              hasAfter: true,
            },
          },
          {
            moduleId: 'alpha',
            type: 'component-override',
            id: 'alpha.page:customers',
            target: 'page:customers',
            priority: 7,
            features: ['alpha.view'],
            details: { overrideKind: 'wrapper' },
          },
          {
            moduleId: 'alpha',
            type: 'component-override',
            id: 'alpha.page:orders',
            target: 'page:orders',
            priority: 0,
            details: { overrideKind: 'replacement' },
          },
          {
            moduleId: 'alpha',
            type: 'component-override',
            id: 'alpha.page:products',
            target: 'page:products',
            priority: 0,
            details: { overrideKind: 'propsTransform' },
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.simple',
            target: 'crud-form:customers:fields',
            priority: 0,
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.priority',
            target: 'crud-form:customers:fields',
            priority: 9,
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.sidebar',
            target: 'page:customers:sidebar',
            priority: 2,
          },
        ],
      },
    ])

    expect(mockResolveModuleFile).toHaveBeenCalledWith(
      moduleConfig.roots,
      {
        appBase: '../../src/modules/alpha',
        pkgBase: '@open-mercato/core/modules/alpha',
      },
      'acl.ts',
    )
  })

  it('warns on load failures and still returns module entries', () => {
    const brokenModule: MockModuleConfig = {
      entry: { id: 'broken', from: '@open-mercato/core' },
      roots: {
        appBase: path.join(tmpDir, 'app', 'broken'),
        pkgBase: path.join(tmpDir, 'pkg', 'broken'),
      },
      imports: {
        appBase: '@/modules/broken',
        pkgBase: '@open-mercato/core/modules/broken',
      },
    }
    const emptyModule: MockModuleConfig = {
      entry: { id: 'empty', from: '@open-mercato/core' },
      roots: {
        appBase: path.join(tmpDir, 'app', 'empty'),
        pkgBase: path.join(tmpDir, 'pkg', 'empty'),
      },
      imports: {
        appBase: '@/modules/empty',
        pkgBase: '@open-mercato/core/modules/empty',
      },
    }

    const brokenFiles = new Map<string, ResolvedFile>([
      ['acl.ts', writeJsModule(tmpDir, 'broken/acl.js', "throw new Error('acl failed')\n")],
      ['data/enrichers.ts', writeJsModule(tmpDir, 'broken/data/enrichers.js', "throw new Error('enrichers failed')\n")],
      ['api/interceptors.ts', writeJsModule(tmpDir, 'broken/api/interceptors.js', "throw new Error('interceptors failed')\n")],
      ['widgets/components.ts', writeJsModule(tmpDir, 'broken/widgets/components.js', "throw new Error('components failed')\n")],
      ['widgets/injection-table.ts', writeJsModule(tmpDir, 'broken/widgets/injection-table.js', "throw new Error('table failed')\n")],
    ])

    mockResolveModuleFile.mockImplementation((roots, _imps, relativePath) => {
      if (roots.appBase === brokenModule.roots.appBase) {
        return brokenFiles.get(relativePath) ?? null
      }
      return null
    })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    expect(collectUmesData(buildResolver([brokenModule, emptyModule]))).toEqual([
      {
        moduleId: 'broken',
        extensions: [],
        declaredFeatures: [],
      },
      {
        moduleId: 'empty',
        extensions: [],
        declaredFeatures: [],
      },
    ])

    expect(mockResolveModuleFile).toHaveBeenCalledWith(
      brokenModule.roots,
      brokenModule.imports,
      'acl.ts',
    )
    expect(warnSpy.mock.calls.map(([message]) => message)).toEqual([
      '[UMES] Failed to load acl.ts for module "broken":',
      '[UMES] Failed to load data/enrichers.ts for module "broken":',
      '[UMES] Failed to load api/interceptors.ts for module "broken":',
      '[UMES] Failed to load widgets/components.ts for module "broken":',
      '[UMES] Failed to load widgets/injection-table.ts for module "broken":',
    ])
  })
})
