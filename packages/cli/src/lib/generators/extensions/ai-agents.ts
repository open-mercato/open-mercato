import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  arrayLiteral,
  arrowFunction,
  binaryExpression,
  identifier,
  methodCall,
  objectLiteral,
  parenthesized,
  propertyAccess,
  writeValue,
} from '../ast'
import {
  emptyArray,
  emptyObject,
  moduleEntry,
  namespaceFallback,
  namespaceImportSpec,
  renderGeneratedTsSource,
} from './shared'

/**
 * Generator extension for `<module>/ai-agents.ts` files.
 *
 * Each module's `ai-agents.ts` may export both base agent contributions
 * (`aiAgents`), additive extensions for existing agents
 * (`aiAgentExtensions`), AND cross-module override declarations
 * (`aiAgentOverrides`). The generator scans the file once, emits the
 * configuration entry with all fields, and produces filtered
 * exports inside `ai-agents.generated.ts`:
 *
 *   - `aiAgentConfigEntries` (entries that declare base agents)
 *   - `aiAgentExtensionEntries` / `allAiAgentExtensions` (entries that append to agents)
 *   - `aiAgentOverrideEntries` (entries that declare overrides)
 *
 * The runtime (`@open-mercato/ai-assistant`) reads
 * `aiAgentConfigEntries` to populate the agent registry,
 * `aiAgentOverrideEntries` to apply cross-module replacements, and
 * `allAiAgentExtensions` to append safe metadata after the base load. See spec
 * `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md`.
 */
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
            {
              name: 'overrides',
              value: namespaceFallback({
                importName,
                members: ['aiAgentOverrides'],
                fallback: emptyObject(),
                castType: 'Record<string, unknown>',
              }),
            },
            {
              name: 'extensions',
              value: namespaceFallback({
                importName,
                members: ['aiAgentExtensions'],
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
            type: '{ moduleId: string; agents: unknown[]; overrides: Record<string, unknown>; extensions: unknown[] }',
          })
          sourceFile.addTypeAlias({
            name: 'AiAgentOverrideConfigEntry',
            type: '{ moduleId: string; overrides: Record<string, unknown> }',
          })
          sourceFile.addTypeAlias({
            name: 'AiAgentExtensionConfigEntry',
            type: '{ moduleId: string; extensions: unknown[] }',
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
                name: 'aiAgentExtensionEntries',
                type: 'AiAgentExtensionConfigEntry[]',
                initializer: methodCall(
                  methodCall(identifier('aiAgentConfigEntriesRaw'), 'filter', [
                    arrowFunction({
                      parameters: ['entry'],
                      body: binaryExpression(propertyAccess(propertyAccess(identifier('entry'), 'extensions'), 'length'), '>', 0),
                    }),
                  ]),
                  'map',
                  [
                    arrowFunction({
                      parameters: ['entry'],
                      body: parenthesized(
                        objectLiteral([
                          { name: 'moduleId', value: propertyAccess(identifier('entry'), 'moduleId') },
                          { name: 'extensions', value: propertyAccess(identifier('entry'), 'extensions') },
                        ]),
                      ),
                    }),
                  ],
                ),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'allAiAgentExtensions',
                initializer: methodCall(identifier('aiAgentExtensionEntries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'extensions'),
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
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'aiAgentOverrideEntries',
                type: 'AiAgentOverrideConfigEntry[]',
                initializer: methodCall(
                  methodCall(identifier('aiAgentConfigEntriesRaw'), 'filter', [
                    arrowFunction({
                      parameters: ['entry'],
                      body: binaryExpression(
                        propertyAccess(
                          methodCall(identifier('Object'), 'keys', [
                            propertyAccess(identifier('entry'), 'overrides'),
                          ]),
                          'length',
                        ),
                        '>',
                        0,
                      ),
                    }),
                  ]),
                  'map',
                  [
                    arrowFunction({
                      parameters: ['entry'],
                      body: parenthesized(
                        objectLiteral([
                          { name: 'moduleId', value: propertyAccess(identifier('entry'), 'moduleId') },
                          { name: 'overrides', value: propertyAccess(identifier('entry'), 'overrides') },
                        ]),
                      ),
                    }),
                  ],
                ),
              },
            ],
          })
        },
      })

      return new Map([['ai-agents.generated.ts', output]])
    },
  }
}
