import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  arrayLiteral,
  arrowFunction,
  binaryExpression,
  callExpression,
  expressionStatement,
  forOfStatement,
  identifier,
  invokeImmediately,
  logicalAnd,
  methodCall,
  nonNullAssertion,
  objectFromEntries,
  objectLiteral,
  optionalPropertyAccess,
  propertyAccess,
  returnStatement,
  templateLiteral,
  writeValue,
} from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createMessagesExtension(): GeneratorExtension {
  const messageTypeImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const messageTypeEntries: WriterFunction[] = []
  const messageObjectTypeImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const messageObjectTypeEntries: WriterFunction[] = []

  return {
    id: 'registry.messages',
    outputFiles: [
      'message-types.generated.ts',
      'message-objects.generated.ts',
      'messages.client.generated.ts',
    ],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'message-types.ts',
        prefix: 'MSG_TYPES',
        importIdRef: ctx.importIdRef,
        standaloneImports: messageTypeImports,
        standaloneEntries: messageTypeEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'types',
              value: namespaceFallback({
                importName,
                members: ['default', 'messageTypes'],
                fallback: emptyArray(),
                castType: 'MessageTypeDefinition[]',
              }),
            },
          ]),
      })

      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'message-objects.ts',
        prefix: 'MSG_OBJECTS',
        importIdRef: ctx.importIdRef,
        standaloneImports: messageObjectTypeImports,
        standaloneEntries: messageObjectTypeEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'types',
              value: namespaceFallback({
                importName,
                members: ['default', 'messageObjectTypes'],
                fallback: emptyArray(),
                castType: 'MessageObjectTypeDefinition[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const messageTypesOutput = renderGeneratedTsSource({
        fileName: 'message-types.generated.ts',
        imports: [
          { namedImports: [{ name: 'MessageTypeDefinition', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/messages/types' },
          ...messageTypeImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'MessageTypeEntry',
            type: '{ moduleId: string; types: MessageTypeDefinition[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'MessageTypeEntry[]',
                initializer: arrayLiteral(messageTypeEntries, writeValue),
              },
              {
                name: 'allTypes',
                initializer: methodCall(identifier('entriesRaw'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'types'),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'messageTypeEntries', initializer: identifier('entriesRaw') },
              { name: 'messageTypes', initializer: identifier('allTypes') },
            ],
          })
          sourceFile.addFunction({
            name: 'getMessageTypes',
            isExported: true,
            returnType: 'MessageTypeDefinition[]',
            statements: [returnStatement(identifier('allTypes'))],
          })
          sourceFile.addFunction({
            name: 'getMessageType',
            isExported: true,
            parameters: [{ name: 'type', type: 'string' }],
            returnType: 'MessageTypeDefinition | undefined',
            statements: [
              returnStatement(
                methodCall(identifier('allTypes'), 'find', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: binaryExpression(
                      propertyAccess(identifier('entry'), 'type'),
                      '===',
                      identifier('type'),
                    ),
                  }),
                ]),
              ),
            ],
          })
        },
      })

      const messageObjectsOutput = renderGeneratedTsSource({
        fileName: 'message-objects.generated.ts',
        imports: [
          { namedImports: [{ name: 'MessageObjectTypeDefinition', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/messages/types' },
          ...messageObjectTypeImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'MessageObjectTypeEntry',
            type: '{ moduleId: string; types: MessageObjectTypeDefinition[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'MessageObjectTypeEntry[]',
                initializer: arrayLiteral(messageObjectTypeEntries, writeValue),
              },
              {
                name: 'allTypes',
                initializer: methodCall(identifier('entriesRaw'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'types'),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'messageObjectTypeEntries', initializer: identifier('entriesRaw') },
              { name: 'messageObjectTypes', initializer: identifier('allTypes') },
            ],
          })
          sourceFile.addFunction({
            name: 'getMessageObjectTypes',
            isExported: true,
            returnType: 'MessageObjectTypeDefinition[]',
            statements: [returnStatement(identifier('allTypes'))],
          })
          sourceFile.addFunction({
            name: 'getMessageObjectType',
            isExported: true,
            parameters: [
              { name: 'module', type: 'string' },
              { name: 'entityType', type: 'string' },
            ],
            returnType: 'MessageObjectTypeDefinition | undefined',
            statements: [
              returnStatement(
                methodCall(identifier('allTypes'), 'find', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: logicalAnd([
                      binaryExpression(propertyAccess(identifier('entry'), 'module'), '===', identifier('module')),
                      binaryExpression(propertyAccess(identifier('entry'), 'entityType'), '===', identifier('entityType')),
                    ]),
                  }),
                ]),
              ),
            ],
          })
        },
      })

      const messagesClientOutput = renderGeneratedTsSource({
        fileName: 'messages.client.generated.ts',
        imports: [
          { namedImports: [{ name: 'ComponentType', isTypeOnly: true }], moduleSpecifier: 'react' },
          {
            namedImports: [
              { name: 'MessageTypeDefinition', isTypeOnly: true },
              { name: 'MessageObjectTypeDefinition', isTypeOnly: true },
              { name: 'MessageListItemProps', isTypeOnly: true },
              { name: 'MessageContentProps', isTypeOnly: true },
              { name: 'MessageActionsProps', isTypeOnly: true },
              { name: 'ObjectDetailProps', isTypeOnly: true },
              { name: 'ObjectPreviewProps', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/messages/types',
          },
          { namedImports: ['registerMessageObjectTypes'], moduleSpecifier: '@open-mercato/core/modules/messages/lib/message-objects-registry' },
          { namedImports: ['configureMessageUiComponentRegistry'], moduleSpecifier: '@open-mercato/core/modules/messages/components/utils/typeUiRegistry' },
          ...messageTypeImports,
          ...messageObjectTypeImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({ name: 'MessageTypeEntry', type: '{ moduleId: string; types: MessageTypeDefinition[] }' })
          sourceFile.addTypeAlias({ name: 'MessageObjectTypeEntry', type: '{ moduleId: string; types: MessageObjectTypeDefinition[] }' })
          sourceFile.addTypeAlias({ name: 'MessageListItemRenderers', isExported: true, type: 'Record<string, ComponentType<MessageListItemProps>>' })
          sourceFile.addTypeAlias({ name: 'MessageContentRenderers', isExported: true, type: 'Record<string, ComponentType<MessageContentProps>>' })
          sourceFile.addTypeAlias({ name: 'MessageActionsRenderers', isExported: true, type: 'Record<string, ComponentType<MessageActionsProps>>' })
          sourceFile.addTypeAlias({ name: 'MessageObjectDetailRenderers', isExported: true, type: 'Record<string, ComponentType<ObjectDetailProps>>' })
          sourceFile.addTypeAlias({ name: 'MessageObjectPreviewRenderers', isExported: true, type: 'Record<string, ComponentType<ObjectPreviewProps>>' })
          sourceFile.addTypeAlias({
            name: 'MessageUiComponentRegistry',
            isExported: true,
            type: '{ listItemComponents: MessageListItemRenderers; contentComponents: MessageContentRenderers; actionsComponents: MessageActionsRenderers; objectDetailComponents: MessageObjectDetailRenderers; objectPreviewComponents: MessageObjectPreviewRenderers }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              { name: 'messageTypeEntriesRaw', type: 'MessageTypeEntry[]', initializer: arrayLiteral(messageTypeEntries, writeValue) },
              { name: 'messageObjectTypeEntriesRaw', type: 'MessageObjectTypeEntry[]', initializer: arrayLiteral(messageObjectTypeEntries, writeValue) },
              {
                name: 'allMessageTypes',
                initializer: methodCall(identifier('messageTypeEntriesRaw'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'types'),
                  }),
                ]),
              },
              {
                name: 'allMessageObjectTypes',
                initializer: methodCall(identifier('messageObjectTypeEntriesRaw'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'types'),
                  }),
                ]),
              },
              {
                name: 'listItemComponents',
                type: 'MessageListItemRenderers',
                initializer: objectFromEntries(
                  methodCall(
                    methodCall(identifier('allMessageTypes'), 'filter', [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: logicalAnd([
                          callExpression(identifier('Boolean'), [optionalPropertyAccess(propertyAccess(identifier('typeDef'), 'ui'), 'listItemComponent')]),
                          callExpression(identifier('Boolean'), [propertyAccess(identifier('typeDef'), 'ListItemComponent')]),
                        ]),
                      }),
                    ]),
                    'map',
                    [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: arrayLiteral(
                          [
                            propertyAccess(nonNullAssertion(propertyAccess(identifier('typeDef'), 'ui')), 'listItemComponent'),
                            nonNullAssertion(propertyAccess(identifier('typeDef'), 'ListItemComponent')),
                          ],
                          writeValue,
                        ),
                      }),
                    ],
                  ),
                ),
              },
              {
                name: 'contentComponents',
                type: 'MessageContentRenderers',
                initializer: objectFromEntries(
                  methodCall(
                    methodCall(identifier('allMessageTypes'), 'filter', [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: logicalAnd([
                          callExpression(identifier('Boolean'), [optionalPropertyAccess(propertyAccess(identifier('typeDef'), 'ui'), 'contentComponent')]),
                          callExpression(identifier('Boolean'), [propertyAccess(identifier('typeDef'), 'ContentComponent')]),
                        ]),
                      }),
                    ]),
                    'map',
                    [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: arrayLiteral(
                          [
                            propertyAccess(nonNullAssertion(propertyAccess(identifier('typeDef'), 'ui')), 'contentComponent'),
                            nonNullAssertion(propertyAccess(identifier('typeDef'), 'ContentComponent')),
                          ],
                          writeValue,
                        ),
                      }),
                    ],
                  ),
                ),
              },
              {
                name: 'actionsComponents',
                type: 'MessageActionsRenderers',
                initializer: objectFromEntries(
                  methodCall(
                    methodCall(identifier('allMessageTypes'), 'filter', [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: logicalAnd([
                          callExpression(identifier('Boolean'), [optionalPropertyAccess(propertyAccess(identifier('typeDef'), 'ui'), 'actionsComponent')]),
                          callExpression(identifier('Boolean'), [propertyAccess(identifier('typeDef'), 'ActionsComponent')]),
                        ]),
                      }),
                    ]),
                    'map',
                    [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: arrayLiteral(
                          [
                            propertyAccess(nonNullAssertion(propertyAccess(identifier('typeDef'), 'ui')), 'actionsComponent'),
                            nonNullAssertion(propertyAccess(identifier('typeDef'), 'ActionsComponent')),
                          ],
                          writeValue,
                        ),
                      }),
                    ],
                  ),
                ),
              },
              {
                name: 'objectDetailComponents',
                type: 'MessageObjectDetailRenderers',
                initializer: objectFromEntries(
                  methodCall(
                    methodCall(identifier('allMessageObjectTypes'), 'filter', [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: callExpression(identifier('Boolean'), [propertyAccess(identifier('typeDef'), 'DetailComponent')]),
                      }),
                    ]),
                    'map',
                    [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: arrayLiteral(
                          [
                            templateLiteral([
                              propertyAccess(identifier('typeDef'), 'module'),
                              ':',
                              propertyAccess(identifier('typeDef'), 'entityType'),
                            ]),
                            nonNullAssertion(propertyAccess(identifier('typeDef'), 'DetailComponent')),
                          ],
                          writeValue,
                        ),
                      }),
                    ],
                  ),
                ),
              },
              {
                name: 'objectPreviewComponents',
                type: 'MessageObjectPreviewRenderers',
                initializer: objectFromEntries(
                  methodCall(
                    methodCall(identifier('allMessageObjectTypes'), 'filter', [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: callExpression(identifier('Boolean'), [propertyAccess(identifier('typeDef'), 'PreviewComponent')]),
                      }),
                    ]),
                    'map',
                    [
                      arrowFunction({
                        parameters: ['typeDef'],
                        body: arrayLiteral(
                          [
                            templateLiteral([
                              propertyAccess(identifier('typeDef'), 'module'),
                              ':',
                              propertyAccess(identifier('typeDef'), 'entityType'),
                            ]),
                            nonNullAssertion(propertyAccess(identifier('typeDef'), 'PreviewComponent')),
                          ],
                          writeValue,
                        ),
                      }),
                    ],
                  ),
                ),
              },
              {
                name: 'registry',
                type: 'MessageUiComponentRegistry',
                initializer: objectLiteral([
                  { name: 'listItemComponents', value: identifier('listItemComponents') },
                  { name: 'contentComponents', value: identifier('contentComponents') },
                  { name: 'actionsComponents', value: identifier('actionsComponents') },
                  { name: 'objectDetailComponents', value: identifier('objectDetailComponents') },
                  { name: 'objectPreviewComponents', value: identifier('objectPreviewComponents') },
                ]),
              },
              {
                name: '__messageUiRegistryBootstrap',
                type: 'void',
                initializer: invokeImmediately(
                  arrowFunction({
                    body: (writer) => {
                      writer.block(() => {
                        forOfStatement({
                          variable: 'entry',
                          iterable: identifier('messageObjectTypeEntriesRaw'),
                          statements: [
                            expressionStatement(
                              callExpression(identifier('registerMessageObjectTypes'), [
                                propertyAccess(identifier('entry'), 'types'),
                              ]),
                            ),
                          ],
                        })(writer)
                        writer.newLine()
                        expressionStatement(
                          callExpression(identifier('configureMessageUiComponentRegistry'), [
                            identifier('registry'),
                          ]),
                        )(writer)
                      })
                    },
                  }),
                ),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'messageClientTypeEntries', initializer: identifier('messageTypeEntriesRaw') },
              { name: 'messageClientObjectTypeEntries', initializer: identifier('messageObjectTypeEntriesRaw') },
              { name: 'messageUiComponentRegistry', initializer: identifier('registry') },
            ],
          })
          sourceFile.addFunction({
            name: 'getMessageUiComponentRegistry',
            isExported: true,
            returnType: 'MessageUiComponentRegistry',
            statements: [returnStatement(identifier('registry'))],
          })
        },
      })

      return new Map([
        ['message-types.generated.ts', messageTypesOutput],
        ['message-objects.generated.ts', messageObjectsOutput],
        ['messages.client.generated.ts', messagesClientOutput],
      ])
    },
  }
}
