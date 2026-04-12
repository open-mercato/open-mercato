import type { GeneratedImportSpec } from '../ast'
import type { ModuleScanContext, StandaloneConfigOptions } from '../extension'
import { createSearchExtension } from '../extensions/search'
import { resolveFirstModuleFile, resolveModuleFile } from '../scanner'

function createScanContext(
  overrides: Partial<ModuleScanContext> = {},
): ModuleScanContext {
  return {
    moduleId: 'catalog',
    roots: {
      appBase: '/tmp/app/src/modules/catalog',
      pkgBase: '/tmp/packages/core/src/modules/catalog',
    },
    imps: {
      appBase: '@/modules/catalog',
      pkgBase: '@open-mercato/core/modules/catalog',
    },
    importIdRef: { value: 1 },
    sharedImports: [],
    resolveModuleFile,
    resolveFirstModuleFile,
    processStandaloneConfig: () => null,
    sanitizeGeneratedModuleSpecifier: (importPath) => importPath,
    ...overrides,
  }
}

describe('createSearchExtension', () => {
  it('registers search.ts discovery with the expected standalone config', () => {
    const processStandaloneConfig = jest.fn(
      (_options: StandaloneConfigOptions) => null,
    )
    const extension = createSearchExtension()
    const ctx = createScanContext({ processStandaloneConfig })

    extension.scanModule(ctx)

    expect(processStandaloneConfig).toHaveBeenCalledTimes(1)
    expect(processStandaloneConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: 'catalog',
        relativePath: 'search.ts',
        prefix: 'SEARCH',
        importIdRef: ctx.importIdRef,
        standaloneImports: expect.any(Array),
        standaloneEntries: expect.any(Array),
        writeConfig: expect.any(Function),
      }),
    )
  })

  it('generates search registry output with namespace fallback and filtered exports', () => {
    const processStandaloneConfig = jest.fn((options: StandaloneConfigOptions) => {
      const standaloneImports = options.standaloneImports as GeneratedImportSpec[]
      standaloneImports.push({
        namespaceImport: 'SEARCH_catalog_1',
        moduleSpecifier: '@open-mercato/core/modules/catalog/search',
      })

      const entry = options.writeConfig?.({
        importName: 'SEARCH_catalog_1',
        moduleId: options.modId,
      })
      if (entry) {
        options.standaloneEntries?.push(entry)
      }

      return 'SEARCH_catalog_1'
    })

    const extension = createSearchExtension()
    extension.scanModule(createScanContext({ processStandaloneConfig }))

    const output = extension.generateOutput().get('search.generated.ts')

    expect(output).toBeDefined()
    expect(output).toMatch(
      /import \{ type SearchModuleConfig \} from ['"]@open-mercato\/shared\/modules\/search['"]/,
    )
    expect(output).toMatch(
      /import \* as SEARCH_catalog_1 from ['"]@open-mercato\/core\/modules\/catalog\/search['"]/,
    )
    expect(output).toMatch(/moduleId:\s*["']catalog["']/)
    expect(output).toMatch(
      /\[\s*["']default["'],\s*["']searchConfig["'],\s*["']config["']\s*\]/,
    )
    expect(output).toContain('entry.config != null')
    expect(output).toContain('searchModuleConfigEntries')
    expect(output).toContain('searchModuleConfigs')
  })

  it('emits an empty registry when no module contributes search.ts', () => {
    const extension = createSearchExtension()

    const output = extension.generateOutput().get('search.generated.ts')

    expect(output).toContain('const entriesRaw: SearchConfigEntry[] = []')
    expect(output).toContain('const entries: ResolvedSearchConfigEntry[] =')
  })
})
