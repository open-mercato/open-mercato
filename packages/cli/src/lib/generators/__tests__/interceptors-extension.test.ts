import type { ModuleScanContext, StandaloneConfigOptions } from '../extension'
import { createInterceptorsExtension } from '../extensions/interceptors'
import { namespaceImportSpec } from '../extensions/shared'

function createScanContext(
  processStandaloneConfig: ModuleScanContext['processStandaloneConfig'] = () => null,
): ModuleScanContext {
  return {
    moduleId: 'orders',
    roots: {
      appBase: '/tmp/app/orders',
      pkgBase: '/tmp/pkg/orders',
    },
    imps: {
      appBase: '@/modules/orders',
      pkgBase: '@open-mercato/core/modules/orders',
    },
    importIdRef: { value: 0 },
    sharedImports: [],
    resolveModuleFile: (() => null) as ModuleScanContext['resolveModuleFile'],
    resolveFirstModuleFile: (() => null) as ModuleScanContext['resolveFirstModuleFile'],
    processStandaloneConfig,
    sanitizeGeneratedModuleSpecifier: (importPath) => importPath,
  }
}

function recordStandaloneInterceptor(options: StandaloneConfigOptions): string {
  const importName = `${options.prefix}_${options.importIdRef.value}`
  options.importIdRef.value += 1

  ;(options.standaloneImports as Array<ReturnType<typeof namespaceImportSpec>>).push(
    namespaceImportSpec(importName, '@open-mercato/core/modules/orders/api/interceptors'),
  )

  if (options.standaloneEntries && options.writeConfig) {
    options.standaloneEntries.push(
      options.writeConfig({
        importName,
        moduleId: options.modId,
      }),
    )
  }

  return importName
}

describe('createInterceptorsExtension', () => {
  it('registers the interceptor convention with standalone scan metadata', () => {
    const extension = createInterceptorsExtension()
    let capturedOptions: StandaloneConfigOptions | null = null

    extension.scanModule(
      createScanContext((options) => {
        capturedOptions = options
        return null
      }),
    )

    expect(extension.id).toBe('registry.interceptors')
    expect(extension.outputFiles).toEqual(['interceptors.generated.ts'])
    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions?.modId).toBe('orders')
    expect(capturedOptions?.relativePath).toBe('api/interceptors.ts')
    expect(capturedOptions?.prefix).toBe('INTERCEPTORS')
    expect(capturedOptions?.roots).toEqual({
      appBase: '/tmp/app/orders',
      pkgBase: '/tmp/pkg/orders',
    })
    expect(capturedOptions?.imps).toEqual({
      appBase: '@/modules/orders',
      pkgBase: '@open-mercato/core/modules/orders',
    })
    expect(capturedOptions?.standaloneEntries).toEqual([])
    expect(capturedOptions?.writeConfig).toBeDefined()
  })

  it('emits an empty generated registry when no modules contribute interceptors', () => {
    const extension = createInterceptorsExtension()
    const output = extension.generateOutput().get('interceptors.generated.ts')

    expect(output).toBeDefined()
    expect(output).toMatch(/type InterceptorEntry = \{\s*moduleId: string;\s*interceptors: ApiInterceptor\[\]\s*\};/s)
    expect(output).toMatch(/export const interceptorEntries: InterceptorEntry\[\] = \[\];/)
  })

  it('falls back across namespace exports when interceptor modules are present', () => {
    const extension = createInterceptorsExtension()

    extension.scanModule(createScanContext(recordStandaloneInterceptor))

    const output = extension.generateOutput().get('interceptors.generated.ts')

    expect(output).toBeDefined()
    expect(output).toMatch(
      /import \* as INTERCEPTORS_0 from ['"]@open-mercato\/core\/modules\/orders\/api\/interceptors['"]/,
    )
    expect(output).toMatch(/moduleId: ['"]orders['"]/)
    expect(output).toMatch(/for \(const key of \[\s*['"]interceptors['"]\s*\]\)/s)
    expect(output).toMatch(/return \[\];/)
    expect(output).toContain('as ApiInterceptor[]')
    expect(output).not.toContain('.interceptors')
    expect(output).not.toContain('.default')
  })
})
