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

export function createInboxOpsSourcesExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.inbox-ops-sources',
    outputFiles: ['inbox-ops-sources.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'inbox-ops-sources.ts',
        prefix: 'INBOX_OPS_SOURCES',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'adapters',
              value: namespaceFallback({
                importName,
                members: ['default', 'inboxOpsSourceAdapters'],
                fallback: emptyArray(),
                castType: 'InboxOpsSourceAdapter[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'inbox-ops-sources.generated.ts',
        imports: [
          {
            namedImports: [
              { name: 'InboxOpsSourceAdapter', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/inbox-ops-sources',
          },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'InboxOpsSourceConfigEntry',
            type: '{ moduleId: string; adapters: InboxOpsSourceAdapter[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'InboxOpsSourceConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
              {
                name: 'entries',
                initializer: methodCall(identifier('entriesRaw'), 'filter', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: binaryExpression(propertyAccess(propertyAccess(identifier('entry'), 'adapters'), 'length'), '>', 0),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'inboxOpsSourceConfigEntries', initializer: identifier('entries') },
              {
                name: 'inboxOpsSourceAdapters',
                type: 'InboxOpsSourceAdapter[]',
                initializer: methodCall(identifier('entries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'adapters'),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'adapterMap',
                initializer: newExpression(identifier('Map'), [
                  methodCall(identifier('inboxOpsSourceAdapters'), 'map', [
                    arrowFunction({
                      parameters: ['adapter'],
                      body: arrayLiteral(
                        [propertyAccess(identifier('adapter'), 'sourceEntityType'), identifier('adapter')],
                        writeValue,
                      ),
                    }),
                  ]),
                ]),
              },
            ],
          })
          sourceFile.addFunction({
            name: 'getInboxOpsSourceAdapter',
            isExported: true,
            parameters: [{ name: 'sourceEntityType', type: 'string' }],
            returnType: 'InboxOpsSourceAdapter | undefined',
            statements: [returnStatement(methodCall(identifier('adapterMap'), 'get', [identifier('sourceEntityType')]))],
          })
        },
        generator: 'registry',
      })

      return new Map([['inbox-ops-sources.generated.ts', output]])
    },
  }
}
