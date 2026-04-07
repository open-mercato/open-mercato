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

export function createAiToolsExtension(): GeneratorExtension {
  const imports = [] as Array<ReturnType<typeof namespaceImportSpec>>
  const entries: WriterFunction[] = []

  return {
    id: 'registry.ai-tools',
    outputFiles: ['ai-tools.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'ai-tools.ts',
        prefix: 'AI_TOOLS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'tools',
              value: namespaceFallback({
                importName,
                members: ['aiTools', 'default'],
                fallback: emptyArray(),
                castType: 'unknown[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'ai-tools.generated.ts',
        imports,
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'AiToolConfigEntry',
            type: '{ moduleId: string; tools: unknown[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'aiToolConfigEntriesRaw',
                type: 'AiToolConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'aiToolConfigEntries',
                type: 'AiToolConfigEntry[]',
                initializer: methodCall(identifier('aiToolConfigEntriesRaw'), 'filter', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: binaryExpression(propertyAccess(propertyAccess(identifier('entry'), 'tools'), 'length'), '>', 0),
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
                name: 'allAiTools',
                initializer: methodCall(identifier('aiToolConfigEntries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'tools'),
                  }),
                ]),
              },
            ],
          })
        },
      })

      return new Map([['ai-tools.generated.ts', output]])
    },
  }
}
