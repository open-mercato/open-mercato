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
 *
 * Only `import()` expressions are stubbed. That is the documented way a server-side
 * `widget.ts` reaches its browser component (`lazyDashboardWidget(() => import('./widget.client'))`),
 * and its result is consumed as a namespace object, so a default-only stub is sufficient.
 * Static imports are left to the bundler: they may request named bindings the stub cannot
 * provide, which esbuild rejects with `No matching export`, failing the whole CLI bundle —
 * the exact class of breakage this module exists to prevent. Restricting the rewrite to
 * dynamic imports also keeps server-side helpers that merely follow a `*.client.ts` naming
 * convention working untouched.
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

/**
 * Render a value as a JavaScript string literal safe to embed in generated source.
 * Everything outside printable ASCII is escaped to a `\uXXXX` sequence, so no character
 * of the input can terminate the literal or be re-interpreted as code — `JSON.stringify`
 * alone is a JSON encoder, not a JavaScript-source escaper.
 */
export function encodeJsStringLiteral(value: string): string {
  let encoded = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '"' || char === '\\') {
      encoded += `\\${char}`
      continue
    }
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) {
      encoded += `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    encoded += char
  }
  return `"${encoded}"`
}

export function renderClientOnlyModuleStub(importPath: string): string {
  const message =
    `[internal] Client-only module ${importPath} is not available in the CLI runtime. ` +
    'It is excluded from the CLI bundle because it renders browser components.'
  return [
    `function clientOnlyModuleUnavailable() { throw new Error(${encodeJsStringLiteral(message)}) }`,
    'export default clientOnlyModuleUnavailable',
  ].join('\n')
}

export function createClientOnlyStubPlugin(): import('esbuild').Plugin {
  return {
    name: 'client-only-stub',
    setup(build) {
      build.onResolve({ filter: CLIENT_ONLY_SUFFIX_PATTERN }, (args) => {
        if (args.kind !== 'dynamic-import') return null
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
