import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { emptyObject, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createTranslatableFieldsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.translatable-fields',
    outputFiles: ['translations-fields.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'translations.ts',
        prefix: 'TRANS_FIELDS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        sharedImports: ctx.sharedImports,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'fields',
              value: namespaceFallback({
                importName,
                members: ['default', 'translatableFields'],
                fallback: emptyObject(),
                castType: 'Record<string, string[]>',
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
        fileName: 'translations-fields.generated.ts',
        imports: [
          { namedImports: ['registerTranslatableFields'], moduleSpecifier: '@open-mercato/shared/lib/localization/translatable-fields' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'TransFieldsEntry',
            type: '{ moduleId: string; fields: Record<string, string[]> }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entries',
                type: 'TransFieldsEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
              {
                name: 'allFields',
                type: 'Record<string, string[]>',
                initializer: (writer) => {
                  writer.write('(() => {')
                  writer.newLine()
                  writer.indent(() => {
                    writer.writeLine('const collected: Record<string, string[]> = {}')
                    writer.writeLine('for (const entry of entries) {')
                    writer.writeLine('  for (const [key, value] of Object.entries(entry.fields)) {')
                    writer.writeLine('    collected[key] = value')
                    writer.writeLine('  }')
                    writer.writeLine('}')
                    writer.writeLine('return collected')
                  })
                  writer.write('})()')
                },
              },
              {
                name: '__translatableFieldRegistration',
                type: 'void',
                initializer: (writer) => writer.write('registerTranslatableFields(allFields)'),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'translatableFieldEntries', initializer: (writer) => writer.write('entries') },
              { name: 'allTranslatableFields', initializer: (writer) => writer.write('allFields') },
              { name: 'allTranslatableEntityTypes', initializer: (writer) => writer.write('Object.keys(allFields)') },
            ],
          })
        },
      })

      return new Map([['translations-fields.generated.ts', output]])
    },
  }
}
