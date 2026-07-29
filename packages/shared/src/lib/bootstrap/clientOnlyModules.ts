/**
 * Client-only modules (`*.client.tsx`) hold browser components and must never enter the
 * CLI bundle graph. App modules are bundled from source by `compileAndImport`, and esbuild
 * inlines dynamic imports into the single output file, hoisting the client file's static
 * imports to the top of the bundle. A wrapper such as `@open-mercato/ui/backend/charts`
 * would then execute on every CLI start and fail on bare Next.js specifiers that Node's
 * ESM resolver cannot resolve.
 *
 * Resolving these files to an inert stub keeps the owning `widget.ts` importable (the CLI
 * reads its metadata when seeding dashboards) while cutting the browser-only subgraph.
 */

export const CLIENT_ONLY_STUB_NAMESPACE = 'om-client-only-stub'

const LOCAL_IMPORT_PATTERN = /^(\.{1,2}\/|@\/)/
const CLIENT_ONLY_SUFFIX_PATTERN = /(^|[\\/])[^\\/]+\.client(\.[cm]?[jt]sx?)?$/

/**
 * Local (relative or `@/` aliased) imports of a `*.client` module. Bare package specifiers
 * are left alone because the bundler already marks them external, so they never get inlined.
 */
export function isClientOnlyModulePath(importPath: string): boolean {
  if (!LOCAL_IMPORT_PATTERN.test(importPath)) return false
  return CLIENT_ONLY_SUFFIX_PATTERN.test(importPath)
}

export function renderClientOnlyModuleStub(importPath: string): string {
  const message =
    `[internal] Client-only module ${importPath} is not available in the CLI runtime. ` +
    'It is excluded from the CLI bundle because it renders browser components.'
  return [
    `function clientOnlyModuleUnavailable() { throw new Error(${JSON.stringify(message)}) }`,
    'export default clientOnlyModuleUnavailable',
  ].join('\n')
}

export function createClientOnlyStubPlugin(): import('esbuild').Plugin {
  return {
    name: 'client-only-stub',
    setup(build) {
      build.onResolve({ filter: CLIENT_ONLY_SUFFIX_PATTERN }, (args) => {
        if (!isClientOnlyModulePath(args.path)) return null
        return { path: args.path, namespace: CLIENT_ONLY_STUB_NAMESPACE }
      })
      build.onLoad({ filter: /.*/, namespace: CLIENT_ONLY_STUB_NAMESPACE }, (args) => ({
        contents: renderClientOnlyModuleStub(args.path),
        loader: 'js',
      }))
    },
  }
}
