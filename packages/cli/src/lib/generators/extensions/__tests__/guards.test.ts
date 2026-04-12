import ts from 'typescript'
import type { ModuleScanContext, StandaloneConfigOptions } from '../../extension'
import { createGuardsExtension } from '../guards'

type NamespaceImportSpec = {
  namespaceImport: string
  moduleSpecifier: string
}

type ScanCall = Pick<StandaloneConfigOptions, 'modId' | 'relativePath' | 'prefix'> & {
  importName: string
  moduleSpecifier: string
}

function parseSource(content: string): ts.SourceFile {
  return ts.createSourceFile('guards.generated.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function hasTypeImport(content: string, symbolName: string, moduleSpecifier: string): boolean {
  const sourceFile = parseSource(content)

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== moduleSpecifier) continue

    const clause = statement.importClause
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue

    for (const element of clause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (importedName === symbolName && (clause.isTypeOnly || element.isTypeOnly)) {
        return true
      }
    }
  }

  return false
}

function buildModuleSpecifier(moduleId: string, relativePath: string): string {
  return `@generated/${moduleId}/${relativePath.replace(/\.ts$/, '')}`
}

function createScanContext(options: {
  moduleId: string
  importIdRef: { value: number }
  calls: ScanCall[]
}): ModuleScanContext {
  return {
    moduleId: options.moduleId,
    roots: {} as ModuleScanContext['roots'],
    imps: {} as ModuleScanContext['imps'],
    importIdRef: options.importIdRef,
    sharedImports: [],
    resolveModuleFile: (() => null) as ModuleScanContext['resolveModuleFile'],
    resolveFirstModuleFile: (() => null) as ModuleScanContext['resolveFirstModuleFile'],
    processStandaloneConfig(config) {
      const importName = `${config.prefix}_${config.modId}_${config.importIdRef.value++}`
      const moduleSpecifier = buildModuleSpecifier(config.modId, config.relativePath)
      const importSpec: NamespaceImportSpec = {
        namespaceImport: importName,
        moduleSpecifier,
      }

      ;(config.standaloneImports as NamespaceImportSpec[]).push(importSpec)
      if (config.sharedImports) {
        ;(config.sharedImports as NamespaceImportSpec[]).push(importSpec)
      }

      if (config.standaloneEntries && config.writeConfig) {
        config.standaloneEntries.push(config.writeConfig({ importName, moduleId: config.modId }))
      }

      options.calls.push({
        modId: config.modId,
        relativePath: config.relativePath,
        prefix: config.prefix,
        importName,
        moduleSpecifier,
      })

      return importName
    },
    sanitizeGeneratedModuleSpecifier(importPath) {
      return importPath
    },
  } satisfies ModuleScanContext
}

describe('createGuardsExtension', () => {
  it('declares the guards registry output contract', () => {
    const extension = createGuardsExtension()

    expect(extension.id).toBe('registry.guards')
    expect(extension.outputFiles).toEqual(['guards.generated.ts'])
  })

  it('emits an empty typed guard registry before any modules are scanned', () => {
    const extension = createGuardsExtension()
    const output = extension.generateOutput().get('guards.generated.ts')

    expect(output).toBeDefined()
    expect(hasTypeImport(output ?? '', 'MutationGuard', '@open-mercato/shared/lib/crud/mutation-guard-registry')).toBe(true)
    expect(output).toMatch(/type GuardEntry = \{\s*moduleId: string;\s*guards: MutationGuard\[\]\s*\};?/s)
    expect(output).toMatch(/export const guardEntries: GuardEntry\[\]\s*=\s*\[\s*\]/s)
  })

  it('scans data/guards.ts modules and generates namespace-fallback entries', () => {
    const extension = createGuardsExtension()
    const importIdRef = { value: 0 }
    const calls: ScanCall[] = []

    extension.scanModule(createScanContext({ moduleId: 'orders', importIdRef, calls }))
    extension.scanModule(createScanContext({ moduleId: 'custom_app', importIdRef, calls }))

    expect(calls).toEqual([
      {
        modId: 'orders',
        relativePath: 'data/guards.ts',
        prefix: 'GUARDS',
        importName: 'GUARDS_orders_0',
        moduleSpecifier: '@generated/orders/data/guards',
      },
      {
        modId: 'custom_app',
        relativePath: 'data/guards.ts',
        prefix: 'GUARDS',
        importName: 'GUARDS_custom_app_1',
        moduleSpecifier: '@generated/custom_app/data/guards',
      },
    ])

    const output = extension.generateOutput().get('guards.generated.ts') ?? ''

    expect(output).toMatch(/import \* as GUARDS_orders_0 from ["']@generated\/orders\/data\/guards["'];/)
    expect(output).toMatch(/import \* as GUARDS_custom_app_1 from ["']@generated\/custom_app\/data\/guards["'];/)
    expect(output).toMatch(/moduleId: ["']orders["']/)
    expect(output).toMatch(/moduleId: ["']custom_app["']/)
    expect(output).toMatch(/for \(const key of \[\s*["']guards["']\s*\]\)/s)
    expect(output).toContain('return [];')
    expect(output).not.toContain('.guards')
    expect(output).not.toContain('.default')
  })
})
