import { VariableDeclarationKind, type CodeBlockWriter } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { scanModuleDir, SCAN_CONFIGS } from '../scanner'
import { arrayLiteral, writeValue } from '../ast'
import { dynamicImportExpression, renderGeneratedTsSource } from './shared'

type DashboardWidgetEntry = {
  moduleId: string
  key: string
  source: 'app' | 'package'
  importPath: string
}

export function createDashboardWidgetsExtension(): GeneratorExtension {
  const widgetEntries = new Map<string, DashboardWidgetEntry>()

  return {
    id: 'registry.dashboard-widgets',
    outputFiles: ['dashboard-widgets.generated.ts'],
    scanModule(ctx) {
      const files = scanModuleDir(ctx.roots, SCAN_CONFIGS.dashboardWidgets)
      for (const { relPath, fromApp } of files) {
        const segments = relPath.split('/')
        const file = segments.pop() ?? ''
        const base = file.replace(/\.(t|j)sx?$/, '')
        const importPath = ctx.sanitizeGeneratedModuleSpecifier(
          `${fromApp ? ctx.imps.appBase : ctx.imps.pkgBase}/widgets/dashboard/${[...segments, base].join('/')}`
        )
        const key = [ctx.moduleId, ...segments, base].filter(Boolean).join(':')
        const entry: DashboardWidgetEntry = {
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
    },
    generateOutput() {
      const entries = Array.from(widgetEntries.entries())
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

      const output = renderGeneratedTsSource({
        fileName: 'dashboard-widgets.generated.ts',
        imports: [
          { namedImports: [{ name: 'ModuleDashboardWidgetEntry', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/registry' },
        ],
        build(sourceFile) {
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'dashboardWidgetEntries',
                type: 'ModuleDashboardWidgetEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
        },
      })

      return new Map([['dashboard-widgets.generated.ts', output]])
    },
  }
}
