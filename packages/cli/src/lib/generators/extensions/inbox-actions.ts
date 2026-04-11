import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  arrayLiteral,
  arrowFunction,
  binaryExpression,
  identifier,
  methodCall,
  newExpression,
  propertyAccess,
  returnStatement,
  writeValue,
} from '../ast'
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
                castType: 'InboxActionDefinition[]',
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
                initializer: methodCall(identifier('entriesRaw'), 'filter', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: binaryExpression(propertyAccess(propertyAccess(identifier('entry'), 'actions'), 'length'), '>', 0),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'inboxActionConfigEntries', initializer: identifier('entries') },
              {
                name: 'inboxActions',
                type: 'InboxActionDefinition[]',
                initializer: methodCall(identifier('entries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'actions'),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'actionTypeMap',
                initializer: newExpression(identifier('Map'), [
                  methodCall(identifier('inboxActions'), 'map', [
                    arrowFunction({
                      parameters: ['action'],
                      body: arrayLiteral(
                        [
                          propertyAccess(identifier('action'), 'type'),
                          identifier('action'),
                        ],
                        writeValue,
                      ),
                    }),
                  ]),
                ]),
              },
            ],
          })
          sourceFile.addFunction({
            name: 'getInboxAction',
            isExported: true,
            parameters: [{ name: 'type', type: 'string' }],
            returnType: 'InboxActionDefinition | undefined',
            statements: [returnStatement(methodCall(identifier('actionTypeMap'), 'get', [identifier('type')]))],
          })
          sourceFile.addFunction({
            name: 'getRegisteredActionTypes',
            isExported: true,
            returnType: 'string[]',
            statements: [
              returnStatement(
                methodCall(identifier('Array'), 'from', [methodCall(identifier('actionTypeMap'), 'keys', [])]),
              ),
            ],
          })
        },
        generator: 'registry',
      })

      return new Map([['inbox-actions.generated.ts', output]])
    },
  }
}
