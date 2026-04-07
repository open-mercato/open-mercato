import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import {
  moduleEntry,
  namespaceFallback,
  namespaceImportSpec,
  renderGeneratedTsSource,
} from './shared'

export function createAnalyticsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.analytics',
    outputFiles: ['analytics.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'analytics.ts',
        prefix: 'ANALYTICS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        sharedImports: ctx.sharedImports,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'config',
              value: namespaceFallback({
                importName,
                members: ['default', 'analyticsConfig', 'config'],
                fallback: (writer) => writer.write('null'),
              }),
            },
          ]),
      })
    },
    getModuleDeclContribution() {
      return null
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'analytics.generated.ts',
        imports: [
          { namedImports: [{ name: 'AnalyticsModuleConfig', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/analytics' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'AnalyticsConfigEntry',
            type: '{ moduleId: string; config: AnalyticsModuleConfig | null }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'AnalyticsConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entries',
                initializer: (writer) => {
                  writer.write('entriesRaw.filter(')
                  writer.write('(entry): entry is { moduleId: string; config: AnalyticsModuleConfig } => entry.config != null')
                  writer.write(')')
                },
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'analyticsModuleConfigEntries',
                initializer: (writer) => writer.write('entries'),
              },
              {
                name: 'analyticsModuleConfigs',
                type: 'AnalyticsModuleConfig[]',
                initializer: (writer) => writer.write('entries.map((entry) => entry.config)'),
              },
            ],
          })
        },
      })

      return new Map([['analytics.generated.ts', output]])
    },
  }
}
