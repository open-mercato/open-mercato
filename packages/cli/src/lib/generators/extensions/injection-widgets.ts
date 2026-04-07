import { VariableDeclarationKind, type CodeBlockWriter } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { scanModuleDir, SCAN_CONFIGS } from '../scanner'
import { arrayLiteral, writeValue } from '../ast'
import { dynamicImportExpression, namespaceImportSpec, renderGeneratedTsSource } from './shared'

type InjectionWidgetEntry = {
  moduleId: string
  key: string
  source: 'app' | 'package'
  importPath: string
}

type InjectionTableEntry = {
  moduleId: string
  importName: string
  importPath: string
}

export function createInjectionWidgetsExtension(): GeneratorExtension {
  const widgetEntries = new Map<string, InjectionWidgetEntry>()
  const tableEntries: InjectionTableEntry[] = []

  return {
    id: 'registry.injection-widgets',
    outputFiles: ['injection-widgets.generated.ts', 'injection-tables.generated.ts'],
    scanModule(ctx) {
      const files = scanModuleDir(ctx.roots, SCAN_CONFIGS.injectionWidgets)
      for (const { relPath, fromApp } of files) {
        const segments = relPath.split('/')
        const file = segments.pop() ?? ''
        const base = file.replace(/\.(t|j)sx?$/, '')
        const importPath = ctx.sanitizeGeneratedModuleSpecifier(
          `${fromApp ? ctx.imps.appBase : ctx.imps.pkgBase}/widgets/injection/${[...segments, base].join('/')}`
        )
        const key = [ctx.moduleId, ...segments, base].filter(Boolean).join(':')
        const entry: InjectionWidgetEntry = {
          moduleId: ctx.moduleId,
          key,
          source: fromApp ? 'app' : 'package',
          importPath,
        }
        const existing = widgetEntries.get(key)
        if (!existing || (existing.source !== 'app' && entry.source === 'app')) {
          widgetEntries.set(key, entry)
        }
      }

      const table = ctx.resolveModuleFile(ctx.roots, ctx.imps, 'widgets/injection-table.ts')
      if (table) {
        tableEntries.push({
          moduleId: ctx.moduleId,
          importName: `InjTable_${ctx.moduleId.replace(/[^a-zA-Z0-9_]/g, '_')}_${ctx.importIdRef.value++}`,
          importPath: ctx.sanitizeGeneratedModuleSpecifier(table.importPath),
        })
      }
    },
    generateOutput() {
      const widgetDecls = Array.from(widgetEntries.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, entry]) => (writer: CodeBlockWriter) => {
          writer.write('{')
          writer.newLine()
          writer.indent(() => {
            writer.writeLine(`moduleId: ${JSON.stringify(entry.moduleId)},`)
            writer.writeLine(`key: ${JSON.stringify(entry.key)},`)
            writer.writeLine(`source: ${JSON.stringify(entry.source)},`)
            writer.write('loader: () => ')
            dynamicImportExpression(entry.importPath)(writer)
            writer.write(".then((mod) => mod.default ?? mod)")
            writer.newLine()
          })
          writer.write('}')
        })

      const widgetsOutput = renderGeneratedTsSource({
        fileName: 'injection-widgets.generated.ts',
        imports: [
          { namedImports: [{ name: 'ModuleInjectionWidgetEntry', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/registry' },
        ],
        build(sourceFile) {
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'injectionWidgetEntries',
                type: 'ModuleInjectionWidgetEntry[]',
                initializer: arrayLiteral(widgetDecls, writeValue),
              },
            ],
          })
        },
      })

      const tableImports = tableEntries.map((entry) => namespaceImportSpec(entry.importName, entry.importPath))
      const tableDecls = tableEntries.map((entry) => (writer: CodeBlockWriter) => {
        writer.write('{')
        writer.newLine()
        writer.indent(() => {
          writer.writeLine(`moduleId: ${JSON.stringify(entry.moduleId)},`)
          writer.write('table: ((')
          writer.write(entry.importName)
          writer.write('.default ?? ')
          writer.write(entry.importName)
          writer.write('.injectionTable) as any) || {}')
          writer.newLine()
        })
        writer.write('}')
      })
      const tablesOutput = renderGeneratedTsSource({
        fileName: 'injection-tables.generated.ts',
        imports: [
          { namedImports: [{ name: 'ModuleInjectionTable', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/widgets/injection' },
          ...tableImports,
        ],
        build(sourceFile) {
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'injectionTables',
                type: 'Array<{ moduleId: string; table: ModuleInjectionTable }>',
                initializer: arrayLiteral(tableDecls, writeValue),
              },
            ],
          })
        },
      })

      return new Map([
        ['injection-widgets.generated.ts', widgetsOutput],
        ['injection-tables.generated.ts', tablesOutput],
      ])
    },
  }
}
