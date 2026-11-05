import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createComponentOverridesExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.component-overrides',
    outputFiles: ['component-overrides.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'widgets/components.ts',
        prefix: 'COMPONENT_OVERRIDES',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'componentOverrides',
              value: namespaceFallback({
                importName,
                members: ['componentOverrides', 'default'],
                fallback: emptyArray(),
                castType: 'ComponentOverride[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'component-overrides.generated.ts',
        imports: [
          { namedImports: [{ name: 'ComponentOverride', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/widgets/component-registry' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'ComponentOverrideEntry',
            type: '{ moduleId: string; componentOverrides: ComponentOverride[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'componentOverrideEntries',
                type: 'ComponentOverrideEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
        },
      })

      return new Map([['component-overrides.generated.ts', output]])
    },
  }
}
