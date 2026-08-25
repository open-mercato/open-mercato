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
import { createLogger } from '@open-mercato/shared/lib/logger'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const logger = createLogger('ai_assistant')

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
 *
 * The `@app` local module entries are the one exception: those targets are raw
 * app TypeScript with no compiled sibling, so they are compiled separately
 * (see `compileAppLocalModuleEntries`) and the registry points at the artifact.
 */
export async function compileAndImportGenerated(tsPath: string): Promise<Record<string, unknown>> {
  const useJestCjsArtifact = isJestRuntime()
  const jsPath = tsPath.replace(/\.ts$/, useJestCjsArtifact ? '.jest.cjs' : '.mjs')
  // appRoot is two directories up from `.mercato/generated/<file>.ts`.
  const appRoot = path.dirname(path.dirname(path.dirname(tsPath)))

  if (!fs.existsSync(tsPath)) {
    throw new Error(`Generated file not found: ${tsPath}`)
  }

  const runtime = useJestCjsArtifact ? 'cjs' : 'esm'
  const tsSource = fs.readFileSync(tsPath, 'utf-8')
  // Runs on every call, not only when the registry itself is stale: the
  // artifact path is stable, so a registry cache hit would otherwise pin an
  // app module's compiled output to whatever it was when the registry was
  // last regenerated.
  const appLocalArtifacts = await compileAppLocalModuleEntries(tsSource, appRoot, runtime)

  const jsExists = fs.existsSync(jsPath)
  const needsCompile =
    !jsExists || fs.statSync(tsPath).mtimeMs > fs.statSync(jsPath).mtimeMs

  if (needsCompile) {
    const esbuild = await import('esbuild')
    const aliasRewritten = rewriteGeneratedAliasImportsForRuntime(
      tsSource,
      appRoot,
      runtime,
      appLocalArtifacts,
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

  if (useJestCjsArtifact) {
    return requireFromHere(jsPath) as Record<string, unknown>
  }
  return (await import(pathToFileURL(jsPath).href)) as Record<string, unknown>
}

function isJestRuntime(): boolean {
  return typeof process.env.JEST_WORKER_ID === 'string'
}

/** Every `../../src/...` specifier the generator emitted for `@app` local modules. */
export function collectAppLocalSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  for (const [, specifier] of source.matchAll(APP_LOCAL_STATIC_IMPORT)) specifiers.add(specifier)
  for (const [, specifier] of source.matchAll(APP_LOCAL_DYNAMIC_IMPORT)) specifiers.add(specifier)
  return [...specifiers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Stable, collision-free artifact name for one app-local specifier. */
function appLocalArtifactName(specifier: string, runtime: 'esm' | 'cjs'): string {
  const slug = specifier.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const digest = crypto.createHash('sha256').update(specifier).digest('hex').slice(0, 8)
  return `${slug}-${digest}.${runtime === 'cjs' ? 'cjs' : 'mjs'}`
}

/**
 * Compile every `@app` local module entry the generated registry references,
 * and map each specifier to its artifact.
 *
 * Package-backed modules (`@open-mercato/*`) never reach here — their bare
 * specifiers resolve through `node_modules` to compiled `.js`. App-local
 * modules have no compiled sibling, and Node cannot load their `.ts` source
 * directly: relative specifiers need explicit extensions under type stripping,
 * and the module's own graph (`./di`, `./data/entities`) carries decorator and
 * enum syntax that type stripping rejects outright. Bundling the entry with
 * every package import left external is what makes the source loadable.
 *
 * A module that fails to compile is logged and left pointing at its raw source,
 * which reproduces the pre-existing resolution error rather than silently
 * dropping the module's tools from the registry.
 */
async function compileAppLocalModuleEntries(
  source: string,
  appRoot: string,
  runtime: 'esm' | 'cjs',
): Promise<Map<string, string>> {
  const specifiers = collectAppLocalSpecifiers(source)
  const artifacts = new Map<string, string>()
  if (specifiers.length === 0) return artifacts

  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  const { compileAppSourceFile } = await import('@open-mercato/shared/lib/bootstrap/appSourceCompiler')

  for (const specifier of specifiers) {
    const target = path.resolve(generatedDir, specifier)
    const tsPath = fs.existsSync(`${target}.ts`)
      ? `${target}.ts`
      : fs.existsSync(target) && target.endsWith('.ts')
        ? target
        : null
    if (tsPath === null) continue

    const outFile = path.join(generatedDir, 'app-modules', appLocalArtifactName(specifier, runtime))
    try {
      await compileAppSourceFile(tsPath, { appRoot, outFile, format: runtime })
      artifacts.set(specifier, outFile)
    } catch (error) {
      logger.warn('Could not compile an app-local module entry for the generated registry', {
        specifier,
        err: error,
      })
    }
  }

  return artifacts
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
 * When `appLocalArtifacts` maps a shape-2 specifier to a compiled artifact, that
 * artifact wins: pointing Node at raw app TypeScript only works while the file
 * and its whole graph stay within what type stripping accepts, which app
 * modules do not (see `compileAppLocalModuleEntries`). Without a mapping both
 * shapes fall back to the same `.ts`-suffix probe. Other specifiers (bare
 * packages, sibling `./` imports) are left untouched. Exported for unit testing.
 */
export function rewriteGeneratedAliasImports(
  source: string,
  appRoot: string,
  appLocalArtifacts?: Map<string, string>,
): string {
  return rewriteGeneratedAliasImportsForRuntime(source, appRoot, 'esm', appLocalArtifacts)
}

const APP_LOCAL_STATIC_IMPORT = /from\s+["']((?:\.\.\/)+src\/[^"']+)["']/g
const APP_LOCAL_DYNAMIC_IMPORT = /import\s*\(\s*["']((?:\.\.\/)+src\/[^"']+)["']\s*\)/g

function rewriteGeneratedAliasImportsForRuntime(
  source: string,
  appRoot: string,
  runtime: 'esm' | 'cjs',
  appLocalArtifacts: Map<string, string> = new Map(),
): string {
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  const toRuntimeLiteral = (target: string): string =>
    toSafeJsStringLiteral(runtime === 'esm' ? pathToFileURL(target).href : target)
  const toResolvedLiteral = (target: string): string => {
    const candidate = fs.existsSync(target)
      ? target
      : fs.existsSync(target + '.ts')
        ? target + '.ts'
        : target
    return toRuntimeLiteral(candidate)
  }
  const resolveAlias = (relativePath: string): string =>
    toResolvedLiteral(path.join(appRoot, relativePath))
  const resolveRelative = (specifier: string): string => {
    const artifact = appLocalArtifacts.get(specifier)
    if (artifact !== undefined) return toRuntimeLiteral(artifact)
    return toResolvedLiteral(path.resolve(generatedDir, specifier))
  }
  return source
    .replace(/from\s+["']@\/([^"']+)["']/g, (_match, relativePath: string) => {
      return `from ${resolveAlias(relativePath)}`
    })
    .replace(/import\s*\(\s*["']@\/([^"']+)["']\s*\)/g, (_match, relativePath: string) => {
      return `import(${resolveAlias(relativePath)})`
    })
    .replace(APP_LOCAL_STATIC_IMPORT, (_match, specifier: string) => {
      return `from ${resolveRelative(specifier)}`
    })
    .replace(APP_LOCAL_DYNAMIC_IMPORT, (_match, specifier: string) => {
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
    logger.warn('Could not register api-routes manifest', { err: error })
    return 0
  }
}
