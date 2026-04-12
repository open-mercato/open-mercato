import type { ModuleImports, ModuleRoots } from '../scanner'
import type { ModuleScanContext, StandaloneConfigOptions } from '../extension'
import { createEnrichersExtension } from '../extensions/enrichers'

type ScanHarnessOptions = {
  moduleId?: string
  importIdStart?: number
  resolvedImportPath?: string | null
}

function createScanHarness(options: ScanHarnessOptions = {}) {
  const moduleId = options.moduleId ?? 'orders'
  const importIdRef = { value: options.importIdStart ?? 0 }
  const recordedConfigs: StandaloneConfigOptions[] = []
  const roots: ModuleRoots = {
    appBase: `/app/src/modules/${moduleId}`,
    pkgBase: `/packages/core/src/modules/${moduleId}`,
  }
  const imps: ModuleImports = {
    appBase: `@/modules/${moduleId}`,
    pkgBase: `@open-mercato/core/modules/${moduleId}`,
  }
  const resolveModuleFile: ModuleScanContext['resolveModuleFile'] = () => null
  const resolveFirstModuleFile: ModuleScanContext['resolveFirstModuleFile'] = () => null

  const ctx: ModuleScanContext = {
    moduleId,
    roots,
    imps,
    importIdRef,
    sharedImports: [],
    resolveModuleFile,
    resolveFirstModuleFile,
    sanitizeGeneratedModuleSpecifier: (importPath) => importPath,
    processStandaloneConfig(config) {
      recordedConfigs.push(config)

      if (!options.resolvedImportPath || !config.standaloneEntries || !config.writeConfig) {
        return null
      }

      const importName = `${config.prefix}_${config.modId}_${importIdRef.value++}`
      const importSpec = {
        namespaceImport: importName,
        moduleSpecifier: options.resolvedImportPath,
      }
      const standaloneImports = config.standaloneImports as Array<typeof importSpec>

      standaloneImports.push(importSpec)
      config.standaloneEntries.push(
        config.writeConfig({
          importName,
          moduleId: config.modId,
        }),
      )

      return importName
    },
  }

  return {
    ctx,
    recordedConfigs,
    importIdRef,
  }
}

describe('createEnrichersExtension', () => {
  it('registers the enrichers convention and renders a typed generated registry', () => {
    const extension = createEnrichersExtension()
    const { ctx, recordedConfigs, importIdRef } = createScanHarness({
      resolvedImportPath: '@open-mercato/core/modules/orders/data/enrichers',
    })

    extension.scanModule(ctx)

    expect(extension.id).toBe('registry.enrichers')
    expect(extension.outputFiles).toEqual(['enrichers.generated.ts'])
    expect(importIdRef.value).toBe(1)
    expect(recordedConfigs).toHaveLength(1)
    expect(recordedConfigs[0]).toMatchObject({
      modId: 'orders',
      relativePath: 'data/enrichers.ts',
      prefix: 'ENRICHERS',
      roots: ctx.roots,
      imps: ctx.imps,
      importIdRef: ctx.importIdRef,
    })

    const output = extension.generateOutput().get('enrichers.generated.ts')

    expect(output).toBeDefined()
    expect(output).toMatch(/import \{ type ResponseEnricher \} from ["']@open-mercato\/shared\/lib\/crud\/response-enricher["']/)
    expect(output).toMatch(/import \* as ENRICHERS_orders_0 from ["']@open-mercato\/core\/modules\/orders\/data\/enrichers["']/)
    expect(output).toContain('type EnricherEntry = { moduleId: string; enrichers: ResponseEnricher[] };')
    expect(output).toMatch(/export const enricherEntries: EnricherEntry\[\] = \[/)
    expect(output).toContain('moduleId: "orders"')
    expect(output).toContain('enrichers: ((() => {')
    expect(output).not.toContain('ENRICHERS_orders_0.enrichers')
  })

  it('emits an empty registry when no enrichers file is discovered', () => {
    const extension = createEnrichersExtension()
    const { ctx, importIdRef } = createScanHarness()

    extension.scanModule(ctx)

    const output = extension.generateOutput().get('enrichers.generated.ts')

    expect(output).toBeDefined()
    expect(importIdRef.value).toBe(0)
    expect(output).toContain('export const enricherEntries: EnricherEntry[] = [];')
    expect(output).not.toMatch(/import \* as ENRICHERS_/)
  })
})
