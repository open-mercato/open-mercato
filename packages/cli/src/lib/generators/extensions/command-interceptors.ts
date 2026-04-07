import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createCommandInterceptorsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.command-interceptors',
    outputFiles: ['command-interceptors.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'commands/interceptors.ts',
        prefix: 'CMD_INTERCEPTORS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'interceptors',
              value: namespaceFallback({
                importName,
                members: ['interceptors', 'default'],
                fallback: emptyArray(),
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'command-interceptors.generated.ts',
        imports: [
          { namedImports: [{ name: 'CommandInterceptor', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/lib/commands/command-interceptor' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'CommandInterceptorEntry',
            type: '{ moduleId: string; interceptors: CommandInterceptor[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'commandInterceptorEntries',
                type: 'CommandInterceptorEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
        },
      })

      return new Map([['command-interceptors.generated.ts', output]])
    },
  }
}
