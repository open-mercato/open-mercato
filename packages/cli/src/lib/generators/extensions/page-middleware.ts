import { VariableDeclarationKind, type WriterFunction } from 'ts-morph'
import type { GeneratorExtension } from '../extension'
import { arrayLiteral, identifier, writeValue } from '../ast'
import { emptyArray, moduleEntry, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

export function createPageMiddlewareExtension(): GeneratorExtension {
  const frontendImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const frontendEntries: WriterFunction[] = []
  const backendImports: Array<ReturnType<typeof namespaceImportSpec>> = []
  const backendEntries: WriterFunction[] = []

  return {
    id: 'registry.page-middleware',
    outputFiles: ['frontend-middleware.generated.ts', 'backend-middleware.generated.ts'],
    scanModule(ctx) {
      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'frontend/middleware.ts',
        prefix: 'FRONTEND_MIDDLEWARE',
        importIdRef: ctx.importIdRef,
        standaloneImports: frontendImports,
        standaloneEntries: frontendEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'middleware',
              value: namespaceFallback({
                importName,
                members: ['middleware', 'default'],
                fallback: emptyArray(),
                castType: 'PageRouteMiddleware[]',
              }),
            },
          ]),
      })

      ctx.processStandaloneConfig({
        roots: ctx.roots,
        imps: ctx.imps,
        modId: ctx.moduleId,
        relativePath: 'backend/middleware.ts',
        prefix: 'BACKEND_MIDDLEWARE',
        importIdRef: ctx.importIdRef,
        standaloneImports: backendImports,
        standaloneEntries: backendEntries,
        writeConfig: ({ importName, moduleId }) =>
          moduleEntry(moduleId, [
            {
              name: 'middleware',
              value: namespaceFallback({
                importName,
                members: ['middleware', 'default'],
                fallback: emptyArray(),
                castType: 'PageRouteMiddleware[]',
              }),
            },
          ]),
      })
    },
    generateOutput() {
      const frontendOutput = renderGeneratedTsSource({
        fileName: 'frontend-middleware.generated.ts',
        imports: [
          {
            namedImports: [
              { name: 'PageMiddlewareRegistryEntry', isTypeOnly: true },
              { name: 'PageRouteMiddleware', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/middleware/page',
          },
          ...frontendImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'FrontendMiddlewareEntry',
            type: '{ moduleId: string; middleware: PageRouteMiddleware[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'FrontendMiddlewareEntry[]',
                initializer: arrayLiteral(frontendEntries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'frontendMiddlewareEntries',
                type: 'PageMiddlewareRegistryEntry[]',
                initializer: identifier('entriesRaw'),
              },
            ],
          })
        },
      })

      const backendOutput = renderGeneratedTsSource({
        fileName: 'backend-middleware.generated.ts',
        imports: [
          {
            namedImports: [
              { name: 'PageMiddlewareRegistryEntry', isTypeOnly: true },
              { name: 'PageRouteMiddleware', isTypeOnly: true },
            ],
            moduleSpecifier: '@open-mercato/shared/modules/middleware/page',
          },
          ...backendImports,
        ],
        build(sourceFile) {
          sourceFile.addTypeAlias({
            name: 'BackendMiddlewareEntry',
            type: '{ moduleId: string; middleware: PageRouteMiddleware[] }',
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
              {
                name: 'entriesRaw',
                type: 'BackendMiddlewareEntry[]',
                initializer: arrayLiteral(backendEntries, writeValue),
              },
            ],
          })
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'backendMiddlewareEntries',
                type: 'PageMiddlewareRegistryEntry[]',
                initializer: identifier('entriesRaw'),
              },
            ],
          })
        },
      })

      return new Map([
        ['frontend-middleware.generated.ts', frontendOutput],
        ['backend-middleware.generated.ts', backendOutput],
      ])
    },
  }
}
