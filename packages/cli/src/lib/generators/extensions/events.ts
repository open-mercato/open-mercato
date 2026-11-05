import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  asExpression,
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
import { moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createEventsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.events',
    outputFiles: ['events.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'events.ts',
        prefix: 'EVENTS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        sharedImports: ctx.sharedImports,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'config',
              value: namespaceFallback({
                importName,
                members: ['default', 'eventsConfig'],
                fallback: identifier('null'),
                castType: 'EventModuleConfigBase | null',
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
        fileName: 'events.generated.ts',
        imports: [
          {
            namedImports: [
              { name: 'EventModuleConfigBase', isTypeOnly: true },
              { name: 'EventDefinition', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/events',
          },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'EventConfigEntry',
            type: '{ moduleId: string; config: EventModuleConfigBase | null }',
          })
          sourceFile.addTypeAlias({
            name: 'ResolvedEventConfigEntry',
            type: '{ moduleId: string; config: EventModuleConfigBase }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'EventConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
              {
                name: 'entries',
                type: 'ResolvedEventConfigEntry[]',
                initializer: asExpression(
                  methodCall(identifier('entriesRaw'), 'filter', [
                    arrowFunction({
                      parameters: ['entry'],
                      body: binaryExpression(propertyAccess(identifier('entry'), 'config'), '!=', null),
                    }),
                  ]),
                  'ResolvedEventConfigEntry[]',
                ),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'eventModuleConfigEntries', initializer: identifier('entries') },
              {
                name: 'eventModuleConfigs',
                type: 'EventModuleConfigBase[]',
                initializer: methodCall(identifier('entries'), 'map', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'config'),
                  }),
                ]),
              },
              {
                name: 'allEvents',
                type: 'EventDefinition[]',
                initializer: methodCall(identifier('entries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(propertyAccess(identifier('entry'), 'config'), 'events'),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'allDeclaredEventIds',
                initializer: newExpression(identifier('Set'), [
                  methodCall(identifier('allEvents'), 'map', [
                    arrowFunction({
                      parameters: ['entry'],
                      body: propertyAccess(identifier('entry'), 'id'),
                    }),
                  ]),
                ]),
              },
            ],
          })
          sourceFile.addFunction({
            name: 'isEventDeclared',
            isExported: true,
            parameters: [{ name: 'eventId', type: 'string' }],
            returnType: 'boolean',
            statements: [
              returnStatement(
                methodCall(identifier('allDeclaredEventIds'), 'has', [identifier('eventId')]),
              ),
            ],
          })
        },
      })

      return new Map([['events.generated.ts', output]])
    },
  }
}
