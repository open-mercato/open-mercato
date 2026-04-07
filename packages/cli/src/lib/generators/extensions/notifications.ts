import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import {
  emptyArray,
  moduleEntry,
  namespaceFallback,
  namespaceImportSpec,
  renderGeneratedTsSource,
  sideEffectImportSpec,
} from './shared'

export function createNotificationsExtension(): GeneratorExtension {
  const notificationImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const notificationTypeEntries: WriterFunction[] = []
  const notificationClientImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const notificationClientTypeEntries: WriterFunction[] = []
  const paymentClientImports: Array<ReturnType<typeof sideEffectImportSpec>> = []
  const notificationHandlerImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const notificationHandlerEntries: WriterFunction[] = []

  return {
    id: 'registry.notifications',
    outputFiles: [
      'notifications.generated.ts',
      'notifications.client.generated.ts',
      'payments.client.generated.ts',
      'notification-handlers.generated.ts',
    ],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'notifications.ts',
        prefix: 'NOTIF',
        importIdRef: ctx.importIdRef,
        standaloneImports: notificationImports,
        standaloneEntries: notificationTypeEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'types',
              value: namespaceFallback({
                importName,
                members: ['default', 'notificationTypes', 'types'],
                fallback: emptyArray(),
                castType: 'NotificationTypeDefinition[]',
              }),
            },
          ]),
      })

      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'notifications.client.ts',
        prefix: 'NOTIF_CLIENT',
        importIdRef: ctx.importIdRef,
        standaloneImports: notificationClientImports,
        standaloneEntries: notificationClientTypeEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'types',
              value: namespaceFallback({
                importName,
                members: ['default'],
                fallback: emptyArray(),
              }),
            },
          ]),
      })

      const paymentClient = ctx.resolveFirstModuleFile(ctx.roots, ctx.imps, [
        'widgets/payments/client.tsx',
        'widgets/payments/client.ts',
      ])
      if (paymentClient) {
        paymentClientImports.push(sideEffectImportSpec(paymentClient.importPath))
      }

      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'notifications.handlers.ts',
        prefix: 'NOTIF_HANDLERS',
        importIdRef: ctx.importIdRef,
        standaloneImports: notificationHandlerImports,
        standaloneEntries: notificationHandlerEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'handlers',
              value: namespaceFallback({
                importName,
                members: ['default', 'notificationHandlers'],
                fallback: emptyArray(),
                castType: 'NotificationHandler[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const notificationsOutput = renderGeneratedTsSource({
        fileName: 'notifications.generated.ts',
        imports: [
          { namedImports: [{ name: 'NotificationTypeDefinition', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/notifications/types' },
          ...notificationImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'NotificationTypeEntry',
            type: '{ moduleId: string; types: NotificationTypeDefinition[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'NotificationTypeEntry[]',
                initializer: arrayLiteral(notificationTypeEntries, writeValue),
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
              { name: 'notificationTypeEntries', initializer: (writer) => writer.write('entriesRaw') },
              { name: 'notificationTypes', initializer: (writer) => writer.write('allTypes') },
            ],
          })
          sourceFile.addFunction({
            name: 'getNotificationTypes',
            isExported: true,
            returnType: 'NotificationTypeDefinition[]',
            statements: ['return allTypes'],
          })
          sourceFile.addFunction({
            name: 'getNotificationType',
            isExported: true,
            parameters: [{ name: 'type', type: 'string' }],
            returnType: 'NotificationTypeDefinition | undefined',
            statements: ['return allTypes.find((entry) => entry.type === type)'],
          })
        },
      })

      const notificationsClientOutput = renderGeneratedTsSource({
        fileName: 'notifications.client.generated.ts',
        imports: [
          { namedImports: [{ name: 'ComponentType', isTypeOnly: true }], moduleSpecifier: 'react' },
          {
            namedImports: [
              { name: 'NotificationTypeDefinition', isTypeOnly: true },
              { name: 'NotificationRendererProps', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/notifications/types',
          },
          ...notificationClientImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'NotificationTypeEntry',
            type: '{ moduleId: string; types: NotificationTypeDefinition[] }',
          })
          sourceFile.addTypeAlias({
            name: 'NotificationRenderers',
            isExported: true,
            type: 'Record<string, ComponentType<NotificationRendererProps>>',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'NotificationTypeEntry[]',
                initializer: arrayLiteral(notificationClientTypeEntries, writeValue),
              },
              {
                name: 'allTypes',
                initializer: (writer) => writer.write('entriesRaw.flatMap((entry) => entry.types)'),
              },
              {
                name: 'renderers',
                type: 'NotificationRenderers',
                initializer: (writer) => {
                  writer.write('Object.fromEntries(')
                  writer.write('allTypes.filter((typeDef) => Boolean(typeDef.Renderer)).map((typeDef) => [typeDef.type, typeDef.Renderer!])')
                  writer.write(')')
                },
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'notificationClientTypeEntries', initializer: (writer) => writer.write('entriesRaw') },
              { name: 'notificationClientTypes', initializer: (writer) => writer.write('allTypes') },
              { name: 'notificationRenderers', initializer: (writer) => writer.write('renderers') },
            ],
          })
          sourceFile.addFunction({
            name: 'getNotificationRenderers',
            isExported: true,
            returnType: 'NotificationRenderers',
            statements: ['return renderers'],
          })
        },
      })

      const paymentsClientOutput = renderGeneratedTsSource({
        fileName: 'payments.client.generated.ts',
        imports: paymentClientImports,
        build(sourceFile) {
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'paymentGatewayClientModuleCount', initializer: String(paymentClientImports.length) },
            ],
          })
        },
      })

      const notificationHandlersOutput = renderGeneratedTsSource({
        fileName: 'notification-handlers.generated.ts',
        imports: [
          { namedImports: [{ name: 'NotificationHandler', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/notifications/handler' },
          ...notificationHandlerImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'NotificationHandlerEntry',
            type: '{ moduleId: string; handlers: NotificationHandler[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'notificationHandlerEntries',
                type: 'NotificationHandlerEntry[]',
                initializer: arrayLiteral(notificationHandlerEntries, writeValue),
              },
            ],
          })
        },
      })

      return new Map([
        ['notifications.generated.ts', notificationsOutput],
        ['notifications.client.generated.ts', notificationsClientOutput],
        ['payments.client.generated.ts', paymentsClientOutput],
        ['notification-handlers.generated.ts', notificationHandlersOutput],
      ])
    },
  }
}
