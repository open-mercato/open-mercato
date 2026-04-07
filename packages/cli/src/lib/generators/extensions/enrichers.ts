import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createEnrichersExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.enrichers',
    outputFiles: ['enrichers.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'data/enrichers.ts',
        prefix: 'ENRICHERS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'enrichers',
              value: namespaceFallback({
                importName,
                members: ['enrichers', 'default'],
                fallback: emptyArray(),
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'enrichers.generated.ts',
        imports: [
          { namedImports: [{ name: 'ResponseEnricher', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/lib/crud/response-enricher' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'EnricherEntry',
            type: '{ moduleId: string; enrichers: ResponseEnricher[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'enricherEntries',
                type: 'EnricherEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
        },
      })

      return new Map([['enrichers.generated.ts', output]])
    },
  }
}
