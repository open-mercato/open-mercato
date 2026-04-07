import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createInboxActionsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.inbox-actions',
    outputFiles: ['inbox-actions.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'inbox-actions.ts',
        prefix: 'INBOX_ACTIONS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'actions',
              value: namespaceFallback({
                importName,
                members: ['default', 'inboxActions'],
                fallback: emptyArray(),
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'inbox-actions.generated.ts',
        imports: [
          { namedImports: [{ name: 'InboxActionDefinition', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/inbox-actions' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'InboxActionConfigEntry',
            type: '{ moduleId: string; actions: InboxActionDefinition[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'InboxActionConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
              {
                name: 'entries',
                initializer: (writer) => {
                  writer.write('entriesRaw.filter(')
                  writer.write('(entry): entry is InboxActionConfigEntry => Array.isArray(entry.actions) && entry.actions.length > 0')
                  writer.write(')')
                },
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'inboxActionConfigEntries', initializer: (writer) => writer.write('entries') },
              {
                name: 'inboxActions',
                type: 'InboxActionDefinition[]',
                initializer: (writer) => writer.write('entries.flatMap((entry) => entry.actions)'),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'actionTypeMap',
                initializer: (writer) => writer.write('new Map(inboxActions.map((action) => [action.type, action]))'),
              },
            ],
          })
          sourceFile.addFunction({
            name: 'getInboxAction',
            isExported: true,
            parameters: [{ name: 'type', type: 'string' }],
            returnType: 'InboxActionDefinition | undefined',
            statements: ['return actionTypeMap.get(type)'],
          })
          sourceFile.addFunction({
            name: 'getRegisteredActionTypes',
            isExported: true,
            returnType: 'string[]',
            statements: ['return Array.from(actionTypeMap.keys())'],
          })
        },
        generator: 'registry',
      })

      return new Map([['inbox-actions.generated.ts', output]])
    },
  }
}
