import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  arrayLiteral,
  arrowFunction,
  assignmentStatement,
  callExpression,
  elementAccess,
  forOfStatement,
  identifier,
  invokeImmediately,
  methodCall,
  objectEntries,
  objectKeys,
  propertyAccess,
  returnStatement,
  variableStatement,
  writeValue,
} from '../ast'
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
                initializer: invokeImmediately(
                  arrowFunction({
                    body: (writer) => {
                      writer.block(() => {
                        variableStatement({
                          name: 'collected',
                          type: 'Record<string, string[]>',
                          initializer: emptyObject(),
                        })(writer)
                        writer.newLine()
                        forOfStatement({
                          variable: 'entry',
                          iterable: identifier('entries'),
                          statements: [
                            forOfStatement({
                              variable: '[key, value]',
                              iterable: objectEntries(propertyAccess(identifier('entry'), 'fields')),
                              statements: [
                                assignmentStatement(
                                  elementAccess(identifier('collected'), identifier('key')),
                                  identifier('value'),
                                ),
                              ],
                            }),
                          ],
                        })(writer)
                        writer.newLine()
                        returnStatement(identifier('collected'))(writer)
                      })
                    },
                  }),
                ),
              },
              {
                name: '__translatableFieldRegistration',
                type: 'void',
                initializer: callExpression(identifier('registerTranslatableFields'), [identifier('allFields')]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'translatableFieldEntries', initializer: identifier('entries') },
              { name: 'allTranslatableFields', initializer: identifier('allFields') },
              { name: 'allTranslatableEntityTypes', initializer: objectKeys(identifier('allFields')) },
            ],
          })
        },
      })

      return new Map([['translations-fields.generated.ts', output]])
    },
  }
}
