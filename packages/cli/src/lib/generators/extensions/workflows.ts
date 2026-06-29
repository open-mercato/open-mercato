import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import {
  asExpression,
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

export function createWorkflowsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.workflows',
    outputFiles: ['workflows.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'workflows.ts',
        prefix: 'WORKFLOWS',
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
                members: ['default', 'workflowsConfig'],
                fallback: identifier('null'),
                castType: 'WorkflowsModuleConfig | null',
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
        fileName: 'workflows.generated.ts',
        imports: [
          {
            namedImports: [
              { name: 'WorkflowsModuleConfig', isTypeOnly: true },
              { name: 'CodeWorkflowDefinition', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/workflows',
          },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'WorkflowsConfigEntry',
            type: '{ moduleId: string; config: WorkflowsModuleConfig | null }',
          })
          sourceFile.addTypeAlias({
            name: 'ResolvedWorkflowsConfigEntry',
            type: '{ moduleId: string; config: WorkflowsModuleConfig }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'WorkflowsConfigEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entries',
                type: 'ResolvedWorkflowsConfigEntry[]',
                initializer: asExpression(
                  methodCall(identifier('entriesRaw'), 'filter', [
                    arrowFunction({
                      parameters: ['entry'],
                      body: binaryExpression(propertyAccess(identifier('entry'), 'config'), '!=', null),
                    }),
                  ]),
                  'ResolvedWorkflowsConfigEntry[]',
                ),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'workflowModuleConfigEntries',
                initializer: identifier('entries'),
              },
              {
                name: 'workflowModuleConfigs',
                type: 'WorkflowsModuleConfig[]',
                initializer: methodCall(identifier('entries'), 'map', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(identifier('entry'), 'config'),
                  }),
                ]),
              },
              {
                name: 'allCodeWorkflows',
                type: 'CodeWorkflowDefinition[]',
                initializer: methodCall(identifier('entries'), 'flatMap', [
                  arrowFunction({
                    parameters: ['entry'],
                    body: propertyAccess(propertyAccess(identifier('entry'), 'config'), 'workflows'),
                  }),
                ]),
              },
            ],
          })
        },
      })

      return new Map([['workflows.generated.ts', output]])
    },
  }
}
