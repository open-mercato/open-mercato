import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
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
                members: ['default', 'messageTypes', 'types'],
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
                members: ['default', 'messageObjectTypes', 'objectTypes', 'types'],
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
                initializer: (writer) => writer.write('entriesRaw.flatMap((entry) => entry.types)'),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'messageTypeEntries', initializer: (writer) => writer.write('entriesRaw') },
              { name: 'messageTypes', initializer: (writer) => writer.write('allTypes') },
            ],
          })
          sourceFile.addFunction({
            name: 'getMessageTypes',
            isExported: true,
            returnType: 'MessageTypeDefinition[]',
            statements: ['return allTypes'],
          })
          sourceFile.addFunction({
            name: 'getMessageType',
            isExported: true,
            parameters: [{ name: 'type', type: 'string' }],
            returnType: 'MessageTypeDefinition | undefined',
            statements: ['return allTypes.find((entry) => entry.type === type)'],
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
                initializer: (writer) => writer.write('entriesRaw.flatMap((entry) => entry.types)'),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'messageObjectTypeEntries', initializer: (writer) => writer.write('entriesRaw') },
              { name: 'messageObjectTypes', initializer: (writer) => writer.write('allTypes') },
            ],
          })
          sourceFile.addFunction({
            name: 'getMessageObjectTypes',
            isExported: true,
            returnType: 'MessageObjectTypeDefinition[]',
            statements: ['return allTypes'],
          })
          sourceFile.addFunction({
            name: 'getMessageObjectType',
            isExported: true,
            parameters: [
              { name: 'module', type: 'string' },
              { name: 'entityType', type: 'string' },
            ],
            returnType: 'MessageObjectTypeDefinition | undefined',
            statements: ['return allTypes.find((entry) => entry.module === module && entry.entityType === entityType)'],
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
              { name: 'allMessageTypes', initializer: (writer) => writer.write('messageTypeEntriesRaw.flatMap((entry) => entry.types)') },
              { name: 'allMessageObjectTypes', initializer: (writer) => writer.write('messageObjectTypeEntriesRaw.flatMap((entry) => entry.types)') },
              {
                name: 'listItemComponents',
                type: 'MessageListItemRenderers',
                initializer: (writer) => writer.write('Object.fromEntries(allMessageTypes.filter((typeDef) => Boolean(typeDef.ui?.listItemComponent) && Boolean(typeDef.ListItemComponent)).map((typeDef) => [typeDef.ui!.listItemComponent!, typeDef.ListItemComponent!]))'),
              },
              {
                name: 'contentComponents',
                type: 'MessageContentRenderers',
                initializer: (writer) => writer.write('Object.fromEntries(allMessageTypes.filter((typeDef) => Boolean(typeDef.ui?.contentComponent) && Boolean(typeDef.ContentComponent)).map((typeDef) => [typeDef.ui!.contentComponent!, typeDef.ContentComponent!]))'),
              },
              {
                name: 'actionsComponents',
                type: 'MessageActionsRenderers',
                initializer: (writer) => writer.write('Object.fromEntries(allMessageTypes.filter((typeDef) => Boolean(typeDef.ui?.actionsComponent) && Boolean(typeDef.ActionsComponent)).map((typeDef) => [typeDef.ui!.actionsComponent!, typeDef.ActionsComponent!]))'),
              },
              {
                name: 'objectDetailComponents',
                type: 'MessageObjectDetailRenderers',
                initializer: (writer) => writer.write('Object.fromEntries(allMessageObjectTypes.filter((typeDef) => Boolean(typeDef.DetailComponent)).map((typeDef) => [`${typeDef.module}:${typeDef.entityType}`, typeDef.DetailComponent!]))'),
              },
              {
                name: 'objectPreviewComponents',
                type: 'MessageObjectPreviewRenderers',
                initializer: (writer) => writer.write('Object.fromEntries(allMessageObjectTypes.filter((typeDef) => Boolean(typeDef.PreviewComponent)).map((typeDef) => [`${typeDef.module}:${typeDef.entityType}`, typeDef.PreviewComponent!]))'),
              },
              {
                name: 'registry',
                type: 'MessageUiComponentRegistry',
                initializer: (writer) => writer.write('{ listItemComponents, contentComponents, actionsComponents, objectDetailComponents, objectPreviewComponents }'),
              },
              {
                name: '__messageUiRegistryBootstrap',
                type: 'void',
                initializer: (writer) => {
                  writer.write('(() => {')
                  writer.newLine()
                  writer.indent(() => {
                    writer.writeLine('for (const entry of messageObjectTypeEntriesRaw) {')
                    writer.writeLine('  registerMessageObjectTypes(entry.types)')
                    writer.writeLine('}')
                    writer.writeLine('configureMessageUiComponentRegistry(registry)')
                  })
                  writer.write('})()')
                },
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'messageClientTypeEntries', initializer: (writer) => writer.write('messageTypeEntriesRaw') },
              { name: 'messageClientObjectTypeEntries', initializer: (writer) => writer.write('messageObjectTypeEntriesRaw') },
              { name: 'messageUiComponentRegistry', initializer: (writer) => writer.write('registry') },
            ],
          })
          sourceFile.addFunction({
            name: 'getMessageUiComponentRegistry',
            isExported: true,
            returnType: 'MessageUiComponentRegistry',
            statements: ['return registry'],
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
