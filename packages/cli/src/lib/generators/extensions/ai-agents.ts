import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  arrayLiteral,
  arrowFunction,
  binaryExpression,
  identifier,
  methodCall,
  propertyAccess,
  writeValue,
} from '../ast'
import {
  emptyArray,
  moduleEntry,
  namespaceFallback,
  namespaceImportSpec,
  renderGeneratedTsSource,
} from './shared'

export function createAiAgentsExtension(): GeneratorExtension {
  const imports = [] as Array<ReturnType<typeof namespaceImportSpec>>
  const entries: WriterFunction[] = []

  return {
    id: 'registry.ai-agents',
    outputFiles: ['ai-agents.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'ai-agents.ts',
        prefix: 'AI_AGENTS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'agents',
              value: namespaceFallback({
                importName,
                members: ['aiAgents', 'default'],
                fallback: emptyArray(),
                castType: 'unknown[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'ai-agents.generated.ts',
        imports,
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'AiAgentConfigEntry',
            type: '{ moduleId: string; agents: unknown[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'aiAgentConfigEntriesRaw',
                type: 'AiAgentConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'aiAgentConfigEntries',
                type: 'AiAgentConfigEntry[]',
                initializer: methodCall(identifier('aiAgentConfigEntriesRaw'), 'filter', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: binaryExpression(propertyAccess(propertyAccess(identifier('entry'), 'agents'), 'length'), '>', 0),
                  }),
                ]),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'allAiAgents',
                initializer: methodCall(identifier('aiAgentConfigEntries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'agents'),
                  }),
                ]),
              },
            ],
          })
        },
      })

      return new Map([['ai-agents.generated.ts', output]])
    },
  }
}
