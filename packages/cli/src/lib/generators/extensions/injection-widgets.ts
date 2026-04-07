import { VariableDeclarationKind } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { scanModuleDir, SCAN_CONFIGS } from '../scanner'
import {
  arrayLiteral,
  arrowFunction,
  identifier,
  methodCall,
  nullishCoalesce,
  objectLiteral,
  propertyAccess,
  writeValue,
} from '../ast'
import { dynamicImportExpression, emptyObject, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

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
        .map(([, entry]) =>
          objectLiteral([
            { name: 'moduleId', value: entry.moduleId },
            { name: 'key', value: entry.key },
            { name: 'source', value: entry.source },
            {
              name: 'loader',
              value: arrowFunction({
                body: methodCall(dynamicImportExpression(entry.importPath), 'then', [
                  arrowFunction({
                    parameters: ['mod'],
                    body: nullishCoalesce([
                      propertyAccess(identifier('mod'), 'default'),
                      identifier('mod'),
                    ]),
                  }),
                ]),
              }),
            },
          ]),
        )

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
      const tableDecls = tableEntries.map((entry) =>
        objectLiteral([
          { name: 'moduleId', value: entry.moduleId },
          {
            name: 'table',
            value: namespaceFallback({
              importName: entry.importName,
              members: ['default', 'injectionTable'],
              fallback: emptyObject(),
              castType: 'ModuleInjectionTable',
            }),
          },
        ]),
      )
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
