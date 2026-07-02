/**
 * Runtime loader for `.mercato/generated/*.generated.ts` registry files.
 *
 * The generated registries import their entries through the `@/` path alias
 * (e.g. `@/.mercato/generated/ai-tools.generated`). That alias is only
 * understood by the Next.js bundler — in a standalone Node process (the
 * `mcp:dev` / `mcp:serve` MCP servers, the CLI tool-test runner) a raw
 * `import('@/.mercato/...')` throws `ERR_MODULE_NOT_FOUND: Cannot find
 * package '@/.mercato'` because Node treats `@/` as a package specifier.
 *
 * These helpers locate the generated `.ts` file on disk and compile-and-import
 * it with esbuild (transpile-only), rewriting `@/` aliases to absolute paths.
 * This mirrors `loadBootstrapData` in
 * `@open-mercato/shared/lib/bootstrap/dynamicLoader` and works in both the
 * monorepo and standalone apps.
 */
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const requireFromHere = createRequire(import.meta.url)

/**
 * Locate a generated registry file (e.g. `ai-tools.generated.ts`) without
 * hardcoding the workspace layout. Searches upward from this module's compiled
 * location for a `apps/mercato/.mercato/generated/<fileName>` (monorepo), then
 * falls back to cwd-relative lookups (standalone apps run from the app dir).
 */
export function findGeneratedFile(fileName: string): string | null {
  const here = (() => {
    try {
      return fileURLToPath(import.meta.url)
    } catch {
      return null
    }
  })()

  if (here) {
    let cursor = path.dirname(here)
    for (let i = 0; i < 12; i++) {
      const candidate = path.join(cursor, 'apps', 'mercato', '.mercato', 'generated', fileName)
      if (fs.existsSync(candidate)) return candidate
      const next = path.dirname(cursor)
      if (next === cursor) break
      cursor = next
    }
  }
  // Fallbacks: cwd-based lookup (CLI invoked from apps/mercato, or a standalone
  // app whose root holds `.mercato/generated`).
  const fromCwd = path.resolve(process.cwd(), 'apps', 'mercato', '.mercato', 'generated', fileName)
  if (fs.existsSync(fromCwd)) return fromCwd
  const fromCwdDirect = path.resolve(process.cwd(), '.mercato', 'generated', fileName)
  if (fs.existsSync(fromCwdDirect)) return fromCwdDirect
  return null
}

/**
 * Compile-and-import a generated registry file on the fly. Rewrites the entry
 * specifiers Node can't resolve standalone (`@/...` aliases and the
 * `../../src/...` relative imports the generator emits for `@app` local
 * modules) to absolute file URLs, transpiles TS → ESM, and emits a sibling
 * `.mjs` we can `import()` from Node. Cached on mtime so repeat calls in the
 * same process don't recompile.
 *
 * Transpile-only (no bundling): the generated registries declare an array
 * literal whose entries are static `import("…")` arrow functions — we want
 * those `import()` strings to stay as runtime imports so Node resolves them
 * lazily through the workspace's normal module resolution. Eagerly bundling
 * pulls Next.js / route-handler internals into the `.mjs` and breaks at runtime
 * (e.g. `next/server` package-exports map).
 */
export type CompileGeneratedOptions = {
  /**
   * Compile-and-inline LOCAL (relative / `@/`) module sources so app-source TS
   * contributions — `apps/<app>/src/modules/<m>/ai-tools.ts` / `ai-agents.ts` —
   * load in the standalone node MCP server. Bare package specifiers
   * (`@open-mercato/*`, `next`, `zod`, `@mikro-orm/*`, …) stay EXTERNAL and are
   * resolved at runtime against the workspace's compiled `dist`, so this neither
   * pulls Next.js internals into the bundle nor duplicates package singletons.
   *
   * Without this, a generated registry that statically imports an app-source
   * `.ts` file throws `ERR_MODULE_NOT_FOUND` under plain node (it cannot load a
   * `.ts`), which aborts the WHOLE registry — not just the one module.
   * Default `false` keeps transpile-only behaviour for registries whose imports
   * are all packages (e.g. `api-routes.generated.ts`).
   * Ignored under Jest, which requires the CJS artifact path.
   */
  bundleLocalModules?: boolean
}

export async function compileAndImportGenerated(
  tsPath: string,
  options: CompileGeneratedOptions = {},
): Promise<Record<string, unknown>> {
  const useJestCjsArtifact = isJestRuntime()
  const bundle = options.bundleLocalModules === true && !useJestCjsArtifact
  // Separate output filename per mode so switching strategies never reuses a
  // stale artifact from the other path via the mtime cache.
  const jsPath = tsPath.replace(/\.ts$/, bundle ? '.bundled.mjs' : useJestCjsArtifact ? '.jest.cjs' : '.mjs')
  // appRoot is two directories up from `.mercato/generated/<file>.ts`.
  const appRoot = path.dirname(path.dirname(path.dirname(tsPath)))

  if (!fs.existsSync(tsPath)) {
    throw new Error(`Generated file not found: ${tsPath}`)
  }

  const jsExists = fs.existsSync(jsPath)
  const needsCompile =
    !jsExists || fs.statSync(tsPath).mtimeMs > fs.statSync(jsPath).mtimeMs

  if (needsCompile) {
    const esbuild = await import('esbuild')
    if (bundle) {
      const result = await esbuild.build({
        entryPoints: [tsPath],
        bundle: true,
        // Keep every bare package specifier external (runtime resolution);
        // only relative / aliased app-source files get compiled and inlined.
        packages: 'external',
        format: 'esm',
        platform: 'node',
        target: 'node18',
        sourcemap: false,
        write: false,
        logLevel: 'silent',
        alias: { '@': appRoot },
      })
      fs.writeFileSync(jsPath, result.outputFiles[0].text)
    } else {
      const tsSource = fs.readFileSync(tsPath, 'utf-8')
      const aliasRewritten = rewriteGeneratedAliasImportsForRuntime(
        tsSource,
        appRoot,
        useJestCjsArtifact ? 'cjs' : 'esm',
      )
      const result = await esbuild.transform(aliasRewritten, {
        loader: 'ts',
        format: useJestCjsArtifact ? 'cjs' : 'esm',
        target: 'node18',
        sourcemap: false,
        sourcefile: tsPath,
      })
      fs.writeFileSync(jsPath, result.code)
    }
  }

  if (useJestCjsArtifact) {
    return requireFromHere(jsPath) as Record<string, unknown>
  }
  return (await import(pathToFileURL(jsPath).href)) as Record<string, unknown>
}

function isJestRuntime(): boolean {
  return typeof process.env.JEST_WORKER_ID === 'string'
}

const UNSAFE_JS_STRING_CHAR_ESCAPES: Record<number, string> = {
  0x3c: '\\u003C', // <  — HTML/script-tag breakout
  0x3e: '\\u003E', // >  — HTML/script-tag breakout
  0x2028: '\\u2028', // line separator — string content but a statement terminator pre-ES2019
  0x2029: '\\u2029', // paragraph separator — same
}

/**
 * Escape characters that `JSON.stringify` leaves intact but which can still
 * break out of (or alter the meaning of) the JavaScript string literal that the
 * stringified value is embedded into — notably `<`/`>` (HTML/script-tag
 * breakout) and the U+2028 / U+2029 line separators (valid string content but
 * statement terminators in pre-ES2019 parsers). Apply this on top of
 * `JSON.stringify` so the emitted import source stays well-formed regardless of
 * the resolved path. Exported for unit testing.
 */
export function escapeUnsafeJsStringChars(value: string): string {
  return value.replace(
    /[<>\u2028\u2029]/g,
    (char) => UNSAFE_JS_STRING_CHAR_ESCAPES[char.charCodeAt(0)],
  )
}

/**
 * Stringify a resolved path into a JavaScript string literal that is safe to
 * embed in generated source: `JSON.stringify` handles quoting/standard escapes,
 * and `escapeUnsafeJsStringChars` neutralizes the characters it leaves intact.
 */
function toSafeJsStringLiteral(value: string): string {
  return escapeUnsafeJsStringChars(JSON.stringify(value))
}

/**
 * Rewrite the two specifier shapes the generator emits for module entries in a
 * generated registry to absolute `file://` URLs Node can resolve in a
 * standalone process:
 *
 *   1. `@/...` path-alias imports (both `from "@/x"` and dynamic `import("@/x")`).
 *      The `@/` alias is a Next.js bundler convention; outside the bundler Node
 *      treats `@/...` as a bare package specifier and throws
 *      `ERR_MODULE_NOT_FOUND`. Resolved against `appRoot`.
 *   2. `../../src/...` relative imports the generator emits for `@app` local
 *      modules (e.g. `from "../../src/modules/<id>/ai-tools"`). esbuild's
 *      transform (transpile-only) leaves these untouched, so the compiled
 *      `.mjs` keeps an extensionless relative specifier that resolves to a
 *      `.ts` file with no compiled `.js`/`.mjs` sibling — Node ESM then throws
 *      `ERR_MODULE_NOT_FOUND`. Resolved against the generated file's directory
 *      (`<appRoot>/.mercato/generated`), the location the generator wrote them
 *      relative to. Package-backed modules (`@open-mercato/*`) are unaffected —
 *      their bare specifiers resolve through `node_modules` to compiled `.js`.
 *
 * Both shapes reuse the same `.ts`-suffix probe so a source-only TypeScript
 * target is loaded directly (Node strips types). Other specifiers (bare
 * packages, sibling `./` imports) are left untouched. Exported for unit testing.
 */
export function rewriteGeneratedAliasImports(source: string, appRoot: string): string {
  return rewriteGeneratedAliasImportsForRuntime(source, appRoot, 'esm')
}

function rewriteGeneratedAliasImportsForRuntime(
  source: string,
  appRoot: string,
  runtime: 'esm' | 'cjs',
): string {
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  const toResolvedLiteral = (target: string): string => {
    const candidate = fs.existsSync(target)
      ? target
      : fs.existsSync(target + '.ts')
        ? target + '.ts'
        : target
    const specifier = runtime === 'esm' ? pathToFileURL(candidate).href : candidate
    return toSafeJsStringLiteral(specifier)
  }
  const resolveAlias = (relativePath: string): string =>
    toResolvedLiteral(path.join(appRoot, relativePath))
  const resolveRelative = (specifier: string): string =>
    toResolvedLiteral(path.resolve(generatedDir, specifier))
  return source
    .replace(/from\s+["']@\/([^"']+)["']/g, (_match, relativePath: string) => {
      return `from ${resolveAlias(relativePath)}`
    })
    .replace(/import\s*\(\s*["']@\/([^"']+)["']\s*\)/g, (_match, relativePath: string) => {
      return `import(${resolveAlias(relativePath)})`
    })
    .replace(/from\s+["']((?:\.\.\/)+src\/[^"']+)["']/g, (_match, specifier: string) => {
      return `from ${resolveRelative(specifier)}`
    })
    .replace(/import\s*\(\s*["']((?:\.\.\/)+src\/[^"']+)["']\s*\)/g, (_match, specifier: string) => {
      return `import(${resolveRelative(specifier)})`
    })
}

/**
 * Compile-and-import `api-routes.generated.ts` and register its manifest with
 * the shared registry. Many module tools are "API-backed" — their handlers
 * delegate to `createAiApiOperationRunner`, which fails closed with
 * "No API route manifest registered" unless the manifest is present. In the
 * Next.js app this is wired at bootstrap, but the standalone MCP servers
 * (`mcp:dev` / `mcp:serve`) bootstrap DI without it, so we register it here.
 *
 * Idempotent: `registerApiRouteManifests` replaces the stored manifest, so
 * calling this repeatedly (e.g. per-request HTTP handlers) is safe. Returns the
 * number of registered routes (0 when the generated file is absent).
 */
export async function ensureApiRouteManifestsRegistered(): Promise<number> {
  const registry = await import('@open-mercato/shared/modules/registry')
  // Already wired (e.g. the Next.js app bootstrap, or a prior call). Leave the
  // existing manifest untouched so we never interfere with the in-app agents
  // framework, which registers it at bootstrap with its own override pipeline.
  const existing = registry.getApiRouteManifests()
  if (existing.length > 0) return existing.length

  const tsPath = findGeneratedFile('api-routes.generated.ts')
  if (!tsPath) return 0
  try {
    const mod = await compileAndImportGenerated(tsPath)
    const apiRoutes = (mod as { apiRoutes?: unknown }).apiRoutes
    if (!Array.isArray(apiRoutes)) return 0
    registry.registerApiRouteManifests(
      apiRoutes as Parameters<typeof registry.registerApiRouteManifests>[0],
    )
    return apiRoutes.length
  } catch (error) {
    console.warn(
      '[MCP Tools] Could not register api-routes manifest:',
      error instanceof Error ? error.message : error,
    )
    return 0
  }
}
