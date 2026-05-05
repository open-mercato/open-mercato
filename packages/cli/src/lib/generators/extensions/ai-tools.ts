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
 * Generator extension for `<module>/ai-tools.ts` files.
 *
 * Each module's `ai-tools.ts` may export both base tool contributions
 * (`aiTools`) AND cross-module override declarations (`aiToolOverrides`).
 * The generator scans the file once and emits two filtered exports
 * inside `ai-tools.generated.ts`:
 *
 *   - `aiToolConfigEntries` (entries that declare base tools)
 *   - `aiToolOverrideEntries` (entries that declare overrides)
 *
 * The runtime (`@open-mercato/ai-assistant`) reads `aiToolConfigEntries`
 * to populate the tool registry and `aiToolOverrideEntries` to apply
 * cross-module replacements after the base load. See spec
 * `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md`.
 */
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
            {
              name: 'overrides',
              value: namespaceFallback({
                importName,
                members: ['aiToolOverrides'],
                fallback: emptyObject(),
                castType: 'Record<string, unknown>',
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
            type: '{ moduleId: string; tools: unknown[]; overrides: Record<string, unknown> }',
          })
          sourceFile.addTypeAlias({
            name: 'AiToolOverrideConfigEntry',
            type: '{ moduleId: string; overrides: Record<string, unknown> }',
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
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'aiToolOverrideEntries',
                type: 'AiToolOverrideConfigEntry[]',
                initializer: methodCall(
                  methodCall(identifier('aiToolConfigEntriesRaw'), 'filter', [
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

      return new Map([['ai-tools.generated.ts', output]])
    },
  }
}
