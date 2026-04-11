import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { PackageResolver } from '../../resolver'
import type { UmesModuleData } from '../collector'

type ResolveResult = {
  absolutePath: string
  fromApp: boolean
  importPath: string
}

type ResolveModuleFileImpl = (
  roots: { appBase: string; pkgBase: string },
  imps: { appBase: string; pkgBase: string },
  relativePath: string,
) => ResolveResult | null

function loadCollectorModule(options: {
  requireModuleImpl: (absolutePath: string) => unknown
  resolveModuleFileImpl: ResolveModuleFileImpl
}) {
  const sourcePath = path.resolve(process.cwd(), 'packages/cli/src/lib/umes/collector.ts')
  const source = fs.readFileSync(sourcePath, 'utf8')
  const requireModule = jest.fn(options.requireModuleImpl)
  const createRequire = jest.fn(() => requireModule)
  const resolveModuleFile = jest.fn(options.resolveModuleFileImpl)

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText.replace(/import\.meta\.url/g, JSON.stringify(`file://${sourcePath.replace(/\\/g, '/')}`))

  const module = { exports: {} as Record<string, unknown> }
  const runtimeRequire = (specifier: string): unknown => {
    if (specifier === 'node:module') {
      return { createRequire }
    }
    if (specifier === '../generators/scanner') {
      return { resolveModuleFile }
    }
    throw new Error(`Unexpected collector dependency: ${specifier}`)
  }

  const executeModule = new Function('require', 'module', 'exports', compiled)
  executeModule(runtimeRequire, module, module.exports)

  return {
    collectUmesData: module.exports.collectUmesData as (resolver: PackageResolver) => UmesModuleData[],
    createRequire,
    requireModule,
    resolveModuleFile,
  }
}

describe('collectUmesData', () => {
  it('collects ACL features and UMES extensions from module files', () => {
    const resolver = {
      loadEnabledModules: () => [{ id: 'alpha', from: '@open-mercato/core' }],
      getModulePaths: () => ({
        appBase: '/repo/apps/mercato/src/modules/alpha',
        pkgBase: '/repo/packages/core/src/modules/alpha',
      }),
      getModuleImportBase: () => ({
        appBase: '@/modules/alpha',
        pkgBase: '@open-mercato/core/modules/alpha',
      }),
    } as unknown as PackageResolver

    const resolvedFiles: Record<string, string> = {
      'acl.ts': '/virtual/alpha/acl.ts',
      'data/enrichers.ts': '/virtual/alpha/data/enrichers.ts',
      'api/interceptors.ts': '/virtual/alpha/api/interceptors.ts',
      'widgets/components.ts': '/virtual/alpha/widgets/components.ts',
      'widgets/injection-table.ts': '/virtual/alpha/widgets/injection-table.ts',
    }
    const loadedModules: Record<string, unknown> = {
      '/virtual/alpha/acl.ts': {
        features: ['alpha.view', { id: 'alpha.manage' }, { id: '' }, null],
      },
      '/virtual/alpha/data/enrichers.ts': {
        enrichers: [
          {
            id: 'alpha.enrich',
            targetEntity: 'customers.person',
            priority: 5,
            features: ['alpha.view'],
            timeout: 5_000,
            critical: true,
            cache: { ttl: 60 },
            queryEngine: {},
          },
          {
            targetEntity: 'ignored',
          },
        ],
      },
      '/virtual/alpha/api/interceptors.ts': {
        default: [
          {
            id: 'alpha.people.guard',
            methods: ['GET', 'POST'],
            targetRoute: '/api/customers/people',
            priority: 2,
            features: ['alpha.manage'],
            before: () => undefined,
          },
          {
            targetRoute: '/api/ignored',
          },
        ],
      },
      '/virtual/alpha/widgets/components.ts': {
        componentOverrides: [
          {
            target: { componentId: 'section:customers.person' },
            replacement: () => undefined,
            priority: 4,
            features: ['alpha.manage'],
          },
          {
            target: { componentId: 'page:dashboard' },
            wrapper: () => undefined,
            priority: 1,
          },
          {
            target: { componentId: 'crud-form:customers.person' },
          },
          {
            target: {},
          },
        ],
      },
      '/virtual/alpha/widgets/injection-table.ts': {
        injectionTable: {
          'detail:customers.person:header': 'alpha.customer_badge',
          'menu:main': { widgetId: 'alpha.nav_item', priority: 9 },
          'list:row': [
            { widgetId: 'alpha.row_widget', priority: 3 },
            'alpha.row_string_widget',
          ],
        },
      },
    }

    const { collectUmesData, createRequire, requireModule, resolveModuleFile } = loadCollectorModule({
      resolveModuleFileImpl: (_roots, imps, relativePath) => {
        const absolutePath = resolvedFiles[relativePath]
        if (!absolutePath) return null
        return {
          absolutePath,
          fromApp: false,
          importPath: `${imps.pkgBase}/${relativePath.replace(/\.(ts|tsx|js|jsx)$/u, '')}`,
        }
      },
      requireModuleImpl: (absolutePath) => {
        const loaded = loadedModules[absolutePath]
        if (!loaded) {
          throw new Error(`Unexpected file load: ${absolutePath}`)
        }
        return loaded
      },
    })

    const result = collectUmesData(resolver)

    expect(createRequire).toHaveBeenCalledTimes(1)
    expect(requireModule).toHaveBeenCalledTimes(5)
    expect(resolveModuleFile).toHaveBeenNthCalledWith(
      1,
      {
        appBase: '/repo/apps/mercato/src/modules/alpha',
        pkgBase: '/repo/packages/core/src/modules/alpha',
      },
      {
        appBase: '@/modules/alpha',
        pkgBase: '@open-mercato/core/modules/alpha',
      },
      'acl.ts',
    )
    expect(result).toEqual([
      {
        moduleId: 'alpha',
        declaredFeatures: ['alpha.view', 'alpha.manage'],
        extensions: [
          {
            moduleId: 'alpha',
            type: 'enricher',
            id: 'alpha.enrich',
            target: 'customers.person',
            priority: 5,
            features: ['alpha.view'],
            details: {
              timeout: 5_000,
              critical: true,
              hasCache: true,
              hasQueryEngine: true,
            },
          },
          {
            moduleId: 'alpha',
            type: 'interceptor',
            id: 'alpha.people.guard',
            target: 'GET,POST /api/customers/people',
            priority: 2,
            features: ['alpha.manage'],
            details: {
              targetRoute: '/api/customers/people',
              methods: ['GET', 'POST'],
              hasBefore: true,
              hasAfter: false,
            },
          },
          {
            moduleId: 'alpha',
            type: 'component-override',
            id: 'alpha.section:customers.person',
            target: 'section:customers.person',
            priority: 4,
            features: ['alpha.manage'],
            details: { overrideKind: 'replacement' },
          },
          {
            moduleId: 'alpha',
            type: 'component-override',
            id: 'alpha.page:dashboard',
            target: 'page:dashboard',
            priority: 1,
            features: undefined,
            details: { overrideKind: 'wrapper' },
          },
          {
            moduleId: 'alpha',
            type: 'component-override',
            id: 'alpha.crud-form:customers.person',
            target: 'crud-form:customers.person',
            priority: 0,
            features: undefined,
            details: { overrideKind: 'propsTransform' },
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.customer_badge',
            target: 'detail:customers.person:header',
            priority: 0,
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.nav_item',
            target: 'menu:main',
            priority: 9,
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.row_widget',
            target: 'list:row',
            priority: 3,
          },
          {
            moduleId: 'alpha',
            type: 'injection-widget',
            id: 'alpha.row_string_widget',
            target: 'list:row',
            priority: 0,
          },
        ],
      },
    ])
  })

  it('uses the app module import base, falls back to default exports, and continues after load errors', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const resolver = {
      loadEnabledModules: () => [
        { id: 'beta', from: '@app' },
        { id: 'gamma', from: '@open-mercato/core' },
      ],
      getModulePaths: (entry: { id: string }) => ({
        appBase: `/repo/apps/mercato/src/modules/${entry.id}`,
        pkgBase: `/repo/packages/core/src/modules/${entry.id}`,
      }),
      getModuleImportBase: (entry: { id: string }) => ({
        appBase: `@/modules/${entry.id}`,
        pkgBase: `@open-mercato/core/modules/${entry.id}`,
      }),
    } as unknown as PackageResolver

    const { collectUmesData, requireModule, resolveModuleFile } = loadCollectorModule({
      resolveModuleFileImpl: (roots, imps, relativePath) => {
        if (roots.appBase.endsWith('/beta')) {
          expect(imps.appBase).toBe('../../src/modules/beta')

          const absolutePath = `/virtual/beta/${relativePath}`
          return {
            absolutePath,
            fromApp: true,
            importPath: `../../src/modules/beta/${relativePath.replace(/\.(ts|tsx|js|jsx)$/u, '')}`,
          }
        }

        return null
      },
      requireModuleImpl: (absolutePath) => {
        if (absolutePath === '/virtual/beta/acl.ts') {
          return {
            default: ['beta.view', { id: 'beta.manage' }],
          }
        }

        if (absolutePath === '/virtual/beta/data/enrichers.ts') {
          throw new Error('bad enrichers')
        }

        if (absolutePath === '/virtual/beta/api/interceptors.ts') {
          return {
            interceptors: { invalid: true },
          }
        }

        if (absolutePath === '/virtual/beta/widgets/components.ts') {
          return {
            default: [
              {
                target: { componentId: 'page:beta' },
                wrapper: () => undefined,
                priority: 8,
                features: ['beta.view'],
              },
            ],
          }
        }

        if (absolutePath === '/virtual/beta/widgets/injection-table.ts') {
          return {
            default: {
              'spot:beta': { widgetId: 'beta.widget' },
            },
          }
        }

        throw new Error(`Unexpected file load: ${absolutePath}`)
      },
    })

    const result = collectUmesData(resolver)

    expect(requireModule).toHaveBeenCalledTimes(5)
    expect(resolveModuleFile).toHaveBeenCalledTimes(10)
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toBe('[UMES] Failed to load data/enrichers.ts for module "beta":')
    expect(consoleWarnSpy.mock.calls[0]?.[1]).toBeInstanceOf(Error)
    expect(result).toEqual([
      {
        moduleId: 'beta',
        declaredFeatures: ['beta.view', 'beta.manage'],
        extensions: [
          {
            moduleId: 'beta',
            type: 'component-override',
            id: 'beta.page:beta',
            target: 'page:beta',
            priority: 8,
            features: ['beta.view'],
            details: { overrideKind: 'wrapper' },
          },
          {
            moduleId: 'beta',
            type: 'injection-widget',
            id: 'beta.widget',
            target: 'spot:beta',
            priority: 0,
          },
        ],
      },
      {
        moduleId: 'gamma',
        declaredFeatures: [],
        extensions: [],
      },
    ])
  })
})
