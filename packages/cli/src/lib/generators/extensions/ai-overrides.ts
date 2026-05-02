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
  moduleEntry,
  namespaceFallback,
  namespaceImportSpec,
  renderGeneratedTsSource,
} from './shared'

/**
 * Generator extension for `<module>/ai-overrides.ts` files.
 *
 * Emits `apps/<app>/.mercato/generated/ai-overrides.generated.ts` with an
 * `aiOverrideEntries` array preserving module load order. Each entry has
 * the shape:
 *
 *   { moduleId: string, overrides: { agents?: ..., tools?: ... } }
 *
 * The runtime (`@open-mercato/ai-assistant`) reads the file lazily and
 * applies the entries after the base agent + tool registries finish
 * loading. See spec
 * `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md`.
 */
export function createAiOverridesExtension(): GeneratorExtension {
  const imports = [] as Array<ReturnType<typeof namespaceImportSpec>>
  const entries: WriterFunction[] = []

  return {
    id: 'registry.ai-overrides',
    outputFiles: ['ai-overrides.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'ai-overrides.ts',
        prefix: 'AI_OVERRIDES',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'overrides',
              value: namespaceFallback({
                importName,
                members: ['aiOverrides', 'default'],
                fallback: '{}',
                castType: 'Record<string, unknown>',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'ai-overrides.generated.ts',
        imports,
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'AiOverrideConfigEntry',
            type: '{ moduleId: string; overrides: Record<string, unknown> }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'aiOverrideEntriesRaw',
                type: 'AiOverrideConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'aiOverrideEntries',
                type: 'AiOverrideConfigEntry[]',
                initializer: methodCall(identifier('aiOverrideEntriesRaw'), 'filter', [
                  arrowFunction({
                    parameters: ['entry'],
                    // Keep entries that declare at least one override key
                    // (agents OR tools). Empty entries are stripped so
                    // the generated file stays grep-friendly.
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
              },
            ],
          })
        },
      })

      return new Map([['ai-overrides.generated.ts', output]])
    },
  }
}
