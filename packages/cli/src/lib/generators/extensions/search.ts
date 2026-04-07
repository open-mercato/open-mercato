import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createSearchExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.search',
    outputFiles: ['search.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'search.ts',
        prefix: 'SEARCH',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'config',
              value: namespaceFallback({
                importName,
                members: ['default', 'searchConfig', 'config'],
                fallback: (writer) => writer.write('null'),
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'search.generated.ts',
        imports: [
          { namedImports: [{ name: 'SearchModuleConfig', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/search' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'SearchConfigEntry',
            type: '{ moduleId: string; config: SearchModuleConfig | null }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'SearchConfigEntry[]',
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
                  writer.write('(entry): entry is { moduleId: string; config: SearchModuleConfig } => entry.config != null')
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
                name: 'searchModuleConfigEntries',
                initializer: (writer) => writer.write('entries'),
              },
              {
                name: 'searchModuleConfigs',
                type: 'SearchModuleConfig[]',
                initializer: (writer) => writer.write('entries.map((entry) => entry.config)'),
              },
            ],
          })
        },
      })

      return new Map([['search.generated.ts', output]])
    },
  }
}
