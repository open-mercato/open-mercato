import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
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
                fallback: (writer) => writer.write('null'),
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
                initializer: (writer) => {
                  writer.write('entriesRaw.filter(')
                  writer.write('(entry): entry is { moduleId: string; config: EventModuleConfigBase } => entry.config != null')
                  writer.write(')')
                },
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              { name: 'eventModuleConfigEntries', initializer: (writer) => writer.write('entries') },
              {
                name: 'eventModuleConfigs',
                type: 'EventModuleConfigBase[]',
                initializer: (writer) => writer.write('entries.map((entry) => entry.config)'),
              },
              {
                name: 'allEvents',
                type: 'EventDefinition[]',
                initializer: (writer) => writer.write('entries.flatMap((entry) => entry.config.events)'),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'allDeclaredEventIds',
                initializer: (writer) => writer.write('new Set(allEvents.map((entry) => entry.id))'),
              },
            ],
          })
          sourceFile.addFunction({
            name: 'isEventDeclared',
            isExported: true,
            parameters: [{ name: 'eventId', type: 'string' }],
            returnType: 'boolean',
            statements: ['return allDeclaredEventIds.has(eventId)'],
          })
        },
      })

      return new Map([['events.generated.ts', output]])
    },
  }
}
