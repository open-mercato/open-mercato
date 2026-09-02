import type { BootstrapData } from './types'
import type { AppDiRegistrar } from '../di/container'
import { findAppRoot, type AppRoot } from './appResolver'
import { registerEntityIds } from '../encryption/entityIds'
import { createLogger } from '../logger'
import {
  applyModuleOverridesFromEnabledModules,
  type ModuleEntryWithOverrides,
} from '../../modules/overrides'
import {
  ensureMikroOrmV7GeneratedCacheCompatibility,
  recoverMikroOrmV7GeneratedCacheFromImportError,
} from './generatedCacheRecovery'
import { CLIENT_ONLY_STUB_NAMESPACE, createClientOnlyStubPlugin } from './clientOnlyModules'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

let activeBootstrapLoads = 0
let esbuildRuntime: typeof import('esbuild') | null = null
let esbuildStopPromise: Promise<void> | null = null

const logger = createLogger('shared').child({ component: 'bootstrap' })

async function getEsbuildRuntime(): Promise<typeof import('esbuild')> {
  if (esbuildStopPromise) await esbuildStopPromise
  if (esbuildRuntime) return esbuildRuntime

  const loadedRuntime = await import('esbuild')
  esbuildRuntime ??= loadedRuntime
  return esbuildRuntime
}

async function withEsbuildLifecycle<T>(load: () => Promise<T>): Promise<T> {
  activeBootstrapLoads += 1

  try {
    return await load()
  } finally {
    activeBootstrapLoads -= 1
    if (activeBootstrapLoads === 0 && esbuildRuntime) {
      // esbuild keeps a helper process alive after build(). Bootstrap compilation
      // is a bounded phase, so release it once every concurrent loader is done.
      // A later build() call transparently starts a fresh helper process.
      const runtimeToStop = esbuildRuntime
      esbuildRuntime = null
      const stopPromise = runtimeToStop.stop().catch((err) => {
        logger.warn('Failed to stop the bootstrap compiler service', { err })
      })
      esbuildStopPromise = stopPromise
      try {
        await stopPromise
      } finally {
        if (esbuildStopPromise === stopPromise) esbuildStopPromise = null
      }
    }
  }
}

/**
 * Thrown when an expected generated source file is absent.
 *
 * Optional registries treat this as the supported compatibility case (an app
 * that never generated the file), which is what makes it distinguishable from
 * a file that exists but fails to compile or import.
 */
class GeneratedFileNotFoundError extends Error {
  readonly filePath: string

  constructor(filePath: string) {
    super(`Generated file not found: ${filePath}`)
    this.name = 'GeneratedFileNotFoundError'
    this.filePath = filePath
  }
}

/**
 * esbuild plugins for the CLI bundle, in resolution order. The client-only stub must come
 * first so it wins over the alias and external plugins for `*.client` dynamic imports.
 *
 * Exported so the wiring itself is testable: a test that only exercises
 * `createClientOnlyStubPlugin` in isolation stays green if the plugin is dropped from this
 * list, which would silently reintroduce #4623.
 */
export function createCliBundlePlugins(appRoot: string): import('esbuild').Plugin[] {
  // Plugin to resolve the @/ alias the way the app tsconfig maps it:
  // `@/.mercato/*` to the app root, every other `@/*` to the app's src/ directory.
  const aliasPlugin: import('esbuild').Plugin = {
    name: 'alias-resolver',
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const rest = args.path.slice('@/'.length)
        const bases = rest.startsWith('.mercato/')
          ? [path.join(appRoot, rest)]
          : [path.join(appRoot, 'src', rest), path.join(appRoot, rest)]
        for (const base of bases) {
          if (fs.existsSync(base) && fs.statSync(base).isFile()) {
            return { path: base }
          }
          for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
            if (fs.existsSync(base + suffix)) {
              return { path: base + suffix }
            }
          }
        }
        // Nothing matched — hand esbuild the literal mapping so it reports the
        // missing file against the path the app author actually wrote.
        return { path: path.join(appRoot, rest) }
      })
    },
  }

  // Plugin to mark non-JSON package imports as external
  const externalNonJsonPlugin: import('esbuild').Plugin = {
    name: 'external-non-json',
    setup(build) {
      // Mark all package imports as external EXCEPT JSON files
      // Filter matches paths that don't start with . or / (package imports like @open-mercato/shared)
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // Skip Windows absolute paths (e.g., C:\...) - they're local files, not packages
        if (/^[a-zA-Z]:/.test(args.path)) {
          return null // Let esbuild handle it
        }
        // If it's a JSON file, let esbuild bundle it
        if (args.path.endsWith('.json')) {
          return null // Let esbuild handle it
        }
        // Otherwise mark as external
        return { path: args.path, external: true }
      })
    },
  }

  return [createClientOnlyStubPlugin(), aliasPlugin, externalNonJsonPlugin]
}

const DYNAMIC_LOADER_CACHE_VERSION = 4

type DynamicLoaderCacheMetadata = {
  version: number
  inputHash: string
  outputHash: string
  dependencies: Record<string, string>
}

function cacheMetadataPath(jsPath: string): string {
  return `${jsPath}.cache.json`
}

function contentHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function parseJsonConfig(content: string): unknown {
  let normalized = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const nextCharacter = content[index + 1]

    if (inString) {
      normalized += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      normalized += character
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      while (index < content.length && content[index] !== '\n') index += 1
      normalized += '\n'
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index += 2
      while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
        index += 1
      }
      index += 1
      continue
    }

    if (character === ',') {
      let lookahead = index + 1
      while (lookahead < content.length && /\s/.test(content[lookahead])) lookahead += 1
      if (content[lookahead] === '}' || content[lookahead] === ']') continue
    }

    normalized += character
  }

  return JSON.parse(normalized)
}

function resolveExistingConfigPath(candidate: string): string | null {
  for (const configPath of [candidate, `${candidate}.json`, path.join(candidate, 'tsconfig.json')]) {
    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) return configPath
  }
  return null
}

function resolvePackageConfig(configPath: string, reference: string): string | null {
  try {
    const resolved = createRequire(pathToFileURL(configPath)).resolve(reference)
    return path.extname(resolved) === '.json' ? resolved : null
  } catch {
    return null
  }
}

function resolveExtendedConfig(configPath: string, reference: string): string {
  if (path.isAbsolute(reference) || reference.startsWith('.')) {
    const resolved = resolveExistingConfigPath(path.resolve(path.dirname(configPath), reference))
    if (resolved) return resolved
  } else {
    for (const packageReference of [reference, `${reference}/tsconfig.json`]) {
      const resolved = resolvePackageConfig(configPath, packageReference)
      if (resolved) return resolved
    }
  }

  throw new Error(`[internal] TypeScript config extends target not found: ${reference}`)
}

function collectTsconfigPaths(entryPath: string, visited: Set<string> = new Set()): string[] {
  const configPath = path.resolve(entryPath)
  if (visited.has(configPath)) return []
  visited.add(configPath)

  const parsed = parseJsonConfig(fs.readFileSync(configPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('extends' in parsed)) return [configPath]

  const extendsValue = parsed.extends
  const references = typeof extendsValue === 'string'
    ? [extendsValue]
    : Array.isArray(extendsValue) && extendsValue.every((value) => typeof value === 'string')
      ? extendsValue
      : []

  return [
    ...references.flatMap((reference) => collectTsconfigPaths(
      resolveExtendedConfig(configPath, reference),
      visited,
    )),
    configPath,
  ]
}

function hashFilesRelativeTo(appRoot: string, filePaths: string[]): Record<string, string> {
  return Object.fromEntries(filePaths.map((filePath) => [
    path.relative(appRoot, filePath).split(path.sep).join('/'),
    contentHash(fs.readFileSync(filePath)),
  ]))
}

function cacheInputHash(tsPath: string, appRoot: string, tsconfigPaths: string[]): string {
  const hash = crypto.createHash('sha256')
  hash.update(JSON.stringify({
    version: DYNAMIC_LOADER_CACHE_VERSION,
    sourceHash: contentHash(fs.readFileSync(tsPath)),
    tsconfigHashes: hashFilesRelativeTo(appRoot, tsconfigPaths),
  }))
  return hash.digest('hex')
}

function dependenciesAreValid(appRoot: string, dependencies: Record<string, string>): boolean {
  return Object.entries(dependencies).every(([relativePath, expectedHash]) => {
    const dependencyPath = path.resolve(appRoot, relativePath)
    return fs.existsSync(dependencyPath)
      && contentHash(fs.readFileSync(dependencyPath)) === expectedHash
  })
}

function collectDependencyHashes(
  appRoot: string,
  inputs: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(inputs)
      .filter((inputPath) => !inputPath.startsWith(`${CLIENT_ONLY_STUB_NAMESPACE}:`))
      .map((inputPath) => {
        const absolutePath = path.isAbsolute(inputPath)
          ? inputPath
          : path.resolve(appRoot, inputPath)
        const relativePath = path.relative(appRoot, absolutePath).split(path.sep).join('/')
        return [relativePath, contentHash(fs.readFileSync(absolutePath))]
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function readCacheMetadata(metadataPath: string): DynamicLoaderCacheMetadata | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'version' in parsed
      && parsed.version === DYNAMIC_LOADER_CACHE_VERSION
      && 'inputHash' in parsed
      && typeof parsed.inputHash === 'string'
      && 'outputHash' in parsed
      && typeof parsed.outputHash === 'string'
      && 'dependencies' in parsed
      && typeof parsed.dependencies === 'object'
      && parsed.dependencies !== null
      && Object.values(parsed.dependencies).every((hash) => typeof hash === 'string')
    ) {
      return {
        version: parsed.version,
        inputHash: parsed.inputHash,
        outputHash: parsed.outputHash,
        dependencies: parsed.dependencies as Record<string, string>,
      }
    }
  } catch {
    return null
  }
  return null
}

function cacheIsValid(
  appRoot: string,
  jsPath: string,
  metadataPath: string,
  expectedInputHash: string,
): boolean {
  if (!fs.existsSync(jsPath)) return false
  const metadata = readCacheMetadata(metadataPath)
  if (!metadata || metadata.inputHash !== expectedInputHash) return false
  return contentHash(fs.readFileSync(jsPath)) === metadata.outputHash
    && dependenciesAreValid(appRoot, metadata.dependencies)
}

/**
 * Options for `compileAndImport`.
 *
 * Both paths default to the generated-registry layout (`<appRoot>/.mercato/generated/<file>.ts`
 * compiled to a `.mjs` sibling). Sources that live elsewhere in the app — `src/di.ts` — MUST pass
 * both explicitly: the default app root is derived by walking three directories up from the source,
 * which only holds inside `.mercato/generated`.
 */
type CompileAndImportOptions = {
  appRoot?: string
  outFile?: string
  allowRecovery?: boolean
}

/**
 * Options for `compileAppSourceFile`.
 *
 * `appRoot` anchors the tsconfig, the `@/` alias resolution and the dependency
 * cache; `outFile` is the absolute path of the artifact to write. `format`
 * selects the module system of that artifact — `'cjs'` exists for the Jest
 * runtime, which cannot `import()` an ESM sibling.
 */
export type CompileAppSourceOptions = {
  appRoot: string
  outFile: string
  format?: 'esm' | 'cjs'
}

/**
 * Compile one app-owned TypeScript source and its relative import graph into a
 * single JavaScript artifact, leaving every package import external.
 *
 * This is the only supported way to load app source (`apps/<app>/src/**`,
 * `.mercato/generated/**`) from a plain Node process. Those files are never
 * compiled to `dist`, and Node's own type stripping cannot load them: it
 * requires explicit file extensions on relative specifiers and rejects the
 * decorator and enum syntax the entities and DI files use.
 *
 * The artifact is cached against the content of the entry, its whole bundled
 * dependency graph, and the tsconfig chain, so an edit anywhere in the graph
 * invalidates it.
 *
 * The build runs inside the shared esbuild lifecycle. Callers outside a
 * bootstrap load — the generated-registry loader compiling an `@app` module —
 * would otherwise hold a build on a service another scope is entitled to
 * `stop()`, and would leave the helper process running afterwards. Nesting is
 * safe: the scope only releases the service when the last participant exits.
 */
export async function compileAppSourceFile(
  tsPath: string,
  options: CompileAppSourceOptions,
): Promise<string> {
  return withEsbuildLifecycle(() => compileAppSourceFileWithActiveEsbuild(tsPath, options))
}

async function compileAppSourceFileWithActiveEsbuild(
  tsPath: string,
  options: CompileAppSourceOptions,
): Promise<string> {
  const { appRoot, outFile } = options
  const format = options.format ?? 'esm'
  const appTsconfig = path.join(appRoot, 'tsconfig.json')
  const metadataPath = cacheMetadataPath(outFile)

  const tsExists = fs.existsSync(tsPath)
  const tsconfigExists = fs.existsSync(appTsconfig)

  if (!tsExists) {
    throw new GeneratedFileNotFoundError(tsPath)
  }
  if (!tsconfigExists) {
    throw new Error(`App TypeScript config not found: ${appTsconfig}`)
  }

  const tsconfigPaths = collectTsconfigPaths(appTsconfig)
  const expectedInputHash = cacheInputHash(tsPath, appRoot, tsconfigPaths)

  if (cacheIsValid(appRoot, outFile, metadataPath, expectedInputHash)) {
    return outFile
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  // Dynamically import esbuild only when needed
  const esbuild = await getEsbuildRuntime()

  // Use esbuild.build with bundling to handle JSON imports
  const result = await esbuild.build({
    entryPoints: [tsPath],
    outfile: outFile,
    absWorkingDir: appRoot,
    bundle: true,
    metafile: true,
    format,
    platform: 'node',
    target: 'node18',
    tsconfig: appTsconfig,
    plugins: createCliBundlePlugins(appRoot),
    // Allow JSON imports
    loader: { '.json': 'json' },
  })
  const metadata: DynamicLoaderCacheMetadata = {
    version: DYNAMIC_LOADER_CACHE_VERSION,
    inputHash: expectedInputHash,
    outputHash: contentHash(fs.readFileSync(outFile)),
    dependencies: {
      ...collectDependencyHashes(appRoot, result.metafile.inputs),
      ...hashFilesRelativeTo(appRoot, tsconfigPaths),
    },
  }
  fs.writeFileSync(metadataPath, JSON.stringify(metadata))

  return outFile
}

/**
 * Compile a TypeScript file to JavaScript using esbuild bundler.
 * This bundles the file and all its dependencies, handling JSON imports properly.
 * The compiled file is written next to the source file with a .mjs extension unless
 * `outFile` says otherwise.
 */
async function compileAndImport(
  tsPath: string,
  options: CompileAndImportOptions = {},
): Promise<Record<string, unknown>> {
  const allowRecovery = options.allowRecovery ?? true
  const jsPath = options.outFile ?? tsPath.replace(/\.ts$/, '.mjs')
  const appRoot = options.appRoot ?? path.dirname(path.dirname(path.dirname(tsPath)))

  await compileAppSourceFile(tsPath, { appRoot, outFile: jsPath })

  // Import the compiled JavaScript
  try {
    const outputHash = contentHash(fs.readFileSync(jsPath))
    const fileUrl = `${pathToFileURL(jsPath).href}?cache=${outputHash}`
    return await import(fileUrl)
  } catch (error) {
    if (!allowRecovery) {
      throw error
    }

    const recovered = recoverMikroOrmV7GeneratedCacheFromImportError(appRoot, error)
    if (!recovered.applied) {
      throw error
    }

    return compileAndImport(tsPath, { ...options, allowRecovery: false })
  }
}


/**
 * Load a generated registry that older apps may not have generated yet.
 *
 * An absent source file is the supported compatibility case and resolves to
 * `fallback` quietly. Any other failure — a compile error, a broken import, a
 * runtime throw at module scope — still resolves to `fallback` so bootstrap
 * keeps working, but is reported at error level: a registry that silently
 * degrades to nothing is exactly how command interceptors stopped applying in
 * worker/CLI processes (#4327, #4491).
 */
async function loadOptionalGeneratedModule(
  tsPath: string,
  fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return await compileAndImport(tsPath)
  } catch (error) {
    if (error instanceof GeneratedFileNotFoundError) {
      logger.debug('Optional generated registry not present, using empty fallback', {
        file: path.basename(tsPath),
      })
      return fallback
    }

    logger.error('Failed to load generated registry, continuing without its entries', {
      file: path.basename(tsPath),
      filePath: tsPath,
      err: error,
    })
    return fallback
  }
}

function resolveAppRootOrThrow(appRoot?: string): AppRoot {
  const resolved: AppRoot | null = appRoot
    ? {
        generatedDir: path.join(appRoot, '.mercato', 'generated'),
        appDir: appRoot,
        mercatoDir: path.join(appRoot, '.mercato'),
      }
    : findAppRoot()

  if (!resolved) {
    throw new Error(
      'Could not find app root with .mercato/generated directory. ' +
        'Make sure you run this command from within a Next.js app directory, ' +
        'or run "yarn mercato generate" first to create the generated files.',
    )
  }

  return resolved
}

/**
 * Load the app-level DI registrar (`src/di.ts`) for the dynamic bootstrap path.
 *
 * The Next.js runtime imports `@/di` statically from its own `src/bootstrap.ts` and hands the
 * registrar to `createBootstrap`. Worker, scheduler and CLI processes bootstrap through
 * `bootstrapFromAppRoot` instead, where the `@/` alias does not exist — so without this the app's
 * DI registrations silently never ran there, and every request container paid a failed
 * `import('@/di')` resolution (the compatibility fallback in `lib/di/container.ts`).
 *
 * An absent `src/di.ts` is the supported case and resolves to `null` quietly. A file that exists
 * but cannot be compiled, imported, or does not export `register` is reported at error level and
 * still resolves to `null`, so a broken app DI module degrades the same way a broken generated
 * registry does (#4327, #4491) instead of taking the whole process down.
 */
async function loadAppDiRegistrar(appDir: string): Promise<AppDiRegistrar | null> {
  const tsPath = path.join(appDir, 'src', 'di.ts')
  if (!fs.existsSync(tsPath)) {
    logger.debug('App-level DI module not present, skipping its registrations', { filePath: tsPath })
    return null
  }

  try {
    const appDiModule = await compileAndImport(tsPath, {
      appRoot: appDir,
      outFile: path.join(appDir, '.mercato', 'generated', 'app-di.compiled.mjs'),
    })
    const register = appDiModule.register
    if (typeof register !== 'function') {
      logger.error('App-level DI module exports no register(); its registrations are skipped', {
        filePath: tsPath,
      })
      return null
    }
    return register as AppDiRegistrar
  } catch (error) {
    logger.error('Failed to load the app-level DI module; its registrations are skipped', {
      filePath: tsPath,
      err: error,
    })
    return null
  }
}

/**
 * Override domains whose applier is not registered by `registerBuiltInModuleOverrideAppliers()`
 * but by importing a domain package for its side effect. `bootstrap-common.ts` does this with a
 * static import right before it dispatches; the dynamic bootstrap path has no bundler to lean on,
 * so it resolves the same modules here — lazily, and only when an app actually declares the
 * domain, so `@open-mercato/shared` keeps its rule of never taking a runtime dependency on a
 * domain package (soft-optional coupling, `packages/core/AGENTS.md` → Cross-Module Coupling).
 */
const OPTIONAL_OVERRIDE_APPLIER_MODULES: Record<string, string> = {
  ai: '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-overrides',
}

/**
 * Import the side-effect module that registers the applier for every declared override domain
 * that has no built-in one. A domain package the app does not install is not an error — there
 * is nothing for that domain to apply to — so a failed resolution is logged and skipped, and the
 * dispatcher's own "domain not yet wired" warning still fires behind it.
 */
async function ensureOptionalOverrideAppliers(enabledModules: ModuleEntryWithOverrides[]): Promise<void> {
  for (const [domain, specifier] of Object.entries(OPTIONAL_OVERRIDE_APPLIER_MODULES)) {
    const declared = enabledModules.some((entry) => {
      const overrides = entry?.overrides as Record<string, unknown> | undefined
      return Boolean(overrides && overrides[domain])
    })
    if (!declared) continue
    try {
      await import(/* @vite-ignore */ specifier)
    } catch (error) {
      logger.debug('Optional override applier module is not installed; the domain has nothing to apply to', {
        domain,
        specifier,
        err: error,
      })
    }
  }
}

/**
 * Dispatch `entry.overrides` declared in the app's `src/modules.ts` for the dynamic
 * bootstrap path.
 *
 * The Next.js runtime imports `enabledModules` statically from its own `src/modules.ts` and
 * calls `applyModuleOverridesFromEnabledModules` from `bootstrap-common.ts` before any registry
 * first-loads. Worker, scheduler and CLI processes bootstrap through `bootstrapFromAppRoot`
 * instead, which only ever compiled the generated `modules.cli.generated.ts` — so an app's
 * `entry.overrides` (encryption maps, ACL features, CLI commands, workers, event subscribers,
 * setup, …) silently never applied there. `seed-encryption` seeding the base encryption maps
 * instead of the app's `overrides.encryption.maps` was the concrete symptom (#5582).
 *
 * An app layout with no `src/modules.ts` at all is logged and skipped — that is a real
 * compatibility case, handled the same way an absent `src/di.ts` is. A file that is *present*
 * but fails to compile or import is not: it throws, matching how this same function treats
 * every other mandatory input and how the Next.js runtime treats this same file (a static
 * import in `bootstrap-common.ts`). Degrading there would put `seed-encryption` back on the
 * base encryption maps while still printing success — #5582's outcome, only quieter.
 */
async function loadAppModuleOverrides(appDir: string): Promise<void> {
  const tsPath = path.join(appDir, 'src', 'modules.ts')
  if (!fs.existsSync(tsPath)) {
    logger.debug('App-level modules file not present, skipping entry.overrides dispatch', { filePath: tsPath })
    return
  }

  let enabledModules: unknown
  try {
    const appModulesModule = await compileAndImport(tsPath, {
      appRoot: appDir,
      outFile: path.join(appDir, '.mercato', 'generated', 'app-modules-overrides.compiled.mjs'),
    })
    enabledModules = appModulesModule.enabledModules
  } catch (error) {
    throw new Error(
      `[internal] Failed to load the app-level modules file (${tsPath}); entry.overrides cannot be applied. ` +
        'Refusing to bootstrap with a partial override set.',
      { cause: error },
    )
  }

  if (!Array.isArray(enabledModules)) {
    throw new Error(
      `[internal] The app-level modules file (${tsPath}) exports no enabledModules array; ` +
        'entry.overrides cannot be applied. Refusing to bootstrap with a partial override set.',
    )
  }

  await ensureOptionalOverrideAppliers(enabledModules as ModuleEntryWithOverrides[])
  applyModuleOverridesFromEnabledModules(enabledModules as ModuleEntryWithOverrides[])
}

/**
 * Dynamically load bootstrap data from a resolved app directory.
 *
 * IMPORTANT: This only works in unbundled contexts (CLI, tsx).
 * Do NOT use this in Next.js bundled code - use static imports instead.
 *
 * For CLI context, we skip loading modules.generated.ts which has Next.js dependencies.
 * CLI commands are discovered separately via the CLI module system.
 *
 * @param appRoot - Optional explicit app root path. If not provided, will search from cwd.
 * @returns The loaded bootstrap data
 * @throws Error if app root cannot be found or generated files are missing
 */
async function loadBootstrapDataWithActiveEsbuild(appRoot?: string): Promise<BootstrapData> {
  const resolved = resolveAppRootOrThrow(appRoot)

  const { generatedDir } = resolved

  ensureMikroOrmV7GeneratedCacheCompatibility(resolved.appDir)

  // IMPORTANT: Load entity IDs FIRST and register them before loading modules.
  // This is because modules (e.g., ce.ts files) use E.xxx.xxx at module scope,
  // and they need entity IDs to be available when they're imported.
  const entityIdsModule = await compileAndImport(path.join(generatedDir, 'entities.ids.generated.ts'))
  registerEntityIds(entityIdsModule.E as BootstrapData['entityIds'])

  // Now load the rest of the generated files.
  // modules.cli.generated.ts excludes Next.js-dependent code (routes, APIs, widgets)
  const [
    modulesModule,
    entitiesModule,
    diModule,
    searchModule,
    commandLoadersModule,
    commandInterceptorsModule,
    workflowsModule,
  ] = await Promise.all([
    compileAndImport(path.join(generatedDir, 'modules.cli.generated.ts')),
    compileAndImport(path.join(generatedDir, 'entities.generated.ts')),
    compileAndImport(path.join(generatedDir, 'di.generated.ts')),
    loadOptionalGeneratedModule(path.join(generatedDir, 'search.generated.ts'), { searchModuleConfigs: [] }),
    loadOptionalGeneratedModule(path.join(generatedDir, 'command-loaders.generated.ts'), { commandLoaderEntries: [] }),
    loadOptionalGeneratedModule(path.join(generatedDir, 'command-interceptors.generated.ts'), {
      commandInterceptorEntries: [],
    }),
    loadOptionalGeneratedModule(path.join(generatedDir, 'workflows.generated.ts'), { allCodeWorkflows: [] }),
  ])

  return {
    modules: modulesModule.modules as BootstrapData['modules'],
    entities: entitiesModule.entities as BootstrapData['entities'],
    diRegistrars: diModule.diRegistrars as BootstrapData['diRegistrars'],
    entityIds: entityIdsModule.E as BootstrapData['entityIds'],
    // Search configs are needed by workers for indexing
    searchModuleConfigs: (searchModule.searchModuleConfigs ?? []) as BootstrapData['searchModuleConfigs'],
    commandLoaderEntries: (commandLoadersModule.commandLoaderEntries ?? []) as BootstrapData['commandLoaderEntries'],
    // Command interceptors must apply in worker/CLI processes too — the
    // interceptor registry is per-process, so relying on the Next.js runtime's
    // registration silently no-ops every interceptor for queued/CLI commands
    // (#4327).
    commandInterceptorEntries: (commandInterceptorsModule.commandInterceptorEntries ??
      []) as BootstrapData['commandInterceptorEntries'],
    // Code workflow definitions are needed by workers to resume code-defined instances
    codeWorkflows: (workflowsModule.allCodeWorkflows ?? []) as BootstrapData['codeWorkflows'],
    // Empty UI-related data - not needed for CLI
    dashboardWidgetEntries: [],
    injectionWidgetEntries: [],
    injectionTables: [],
    interceptorEntries: [],
    componentOverrideEntries: [],
  }
}

export async function loadBootstrapData(appRoot?: string): Promise<BootstrapData> {
  return withEsbuildLifecycle(() => loadBootstrapDataWithActiveEsbuild(appRoot))
}

/**
 * Create and execute bootstrap in CLI context.
 *
 * This is a convenience function that finds the app root, loads the generated
 * data dynamically, and runs bootstrap. Use this in CLI entry points.
 *
 * Returns the loaded bootstrap data so the CLI can register modules directly
 * (avoids module resolution issues when importing @open-mercato/cli/mercato).
 *
 * @param appRoot - Optional explicit app root path
 * @returns The loaded bootstrap data (modules, entities, etc.)
 */
export async function bootstrapFromAppRoot(appRoot?: string): Promise<BootstrapData> {
  const { createBootstrap, waitForAsyncRegistration } = await import('./factory.js')
  const resolved = resolveAppRootOrThrow(appRoot)
  // All three loads compile through esbuild, so they share one lifecycle scope: without it
  // `loadBootstrapData` releases the esbuild helper process and `loadAppDiRegistrar`
  // silently starts a second one that nothing ever stops.
  const { data, appDiRegistrar } = await withEsbuildLifecycle(async () => {
    // Dispatch the app's `entry.overrides` (src/modules.ts) BEFORE any registry
    // first-loads — the `bootstrap()` call below runs `registerModules(data.modules)`,
    // and `registerCliModules` in the mercato bin right after this function returns;
    // both read the override side-registry this populates.
    await loadAppModuleOverrides(resolved.appDir)
    return {
      data: await loadBootstrapData(resolved.appDir),
      appDiRegistrar: await loadAppDiRegistrar(resolved.appDir),
    }
  })
  const bootstrap = createBootstrap(data, appDiRegistrar ? { appDiRegistrar } : {})
  bootstrap()
  // In CLI context, wait for async registrations (UI widgets, search configs, etc.)
  await waitForAsyncRegistration()

  return data
}
