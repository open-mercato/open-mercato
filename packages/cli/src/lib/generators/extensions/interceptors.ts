import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, writeValue } from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createInterceptorsExtension(): GeneratorExtension {
  const imports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const entries: WriterFunction[] = []

  return {
    id: 'registry.interceptors',
    outputFiles: ['interceptors.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'api/interceptors.ts',
        prefix: 'INTERCEPTORS',
        importIdRef: ctx.importIdRef,
        standaloneImports: imports,
        standaloneEntries: entries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'interceptors',
              value: namespaceFallback({
                importName,
                members: ['interceptors'],
                fallback: emptyArray(),
                castType: 'ApiInterceptor[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const output = renderGeneratedTsSource({
        fileName: 'interceptors.generated.ts',
        imports: [
          { namedImports: [{ name: 'ApiInterceptor', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/lib/crud/api-interceptor' },
          ...imports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'InterceptorEntry',
            type: '{ moduleId: string; interceptors: ApiInterceptor[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'interceptorEntries',
                type: 'InterceptorEntry[]',
                initializer: arrayLiteral(entries, writeValue),
              },
            ],
          })
        },
      })

      return new Map([['interceptors.generated.ts', output]])
    },
  }
}
