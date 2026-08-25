import type { BootstrapData } from './types'
import type { AppDiRegistrar } from '../di/container'
import { findAppRoot, type AppRoot } from './appResolver'
import { registerEntityIds } from '../encryption/entityIds'
import { createLogger } from '../logger'
import {
  ensureMikroOrmV7GeneratedCacheCompatibility,
  recoverMikroOrmV7GeneratedCacheFromImportError,
} from './generatedCacheRecovery'
import {
  compileAppSourceFile,
  contentHash,
  createCliBundlePlugins,
  GeneratedFileNotFoundError,
  withEsbuildLifecycle,
} from './appSourceCompiler'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const logger = createLogger('shared').child({ component: 'bootstrap' })

export { compileAppSourceFile, createCliBundlePlugins }
export type { CompileAppSourceOptions } from './appSourceCompiler'

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
  // Both loads compile through esbuild, so they share one lifecycle scope: without it
  // `loadBootstrapData` releases the esbuild helper process and `loadAppDiRegistrar`
  // silently starts a second one that nothing ever stops.
  const { data, appDiRegistrar } = await withEsbuildLifecycle(async () => ({
    data: await loadBootstrapData(resolved.appDir),
    appDiRegistrar: await loadAppDiRegistrar(resolved.appDir),
  }))
  const bootstrap = createBootstrap(data, appDiRegistrar ? { appDiRegistrar } : {})
  bootstrap()
  // In CLI context, wait for async registrations (UI widgets, search configs, etc.)
  await waitForAsyncRegistration()

  return data
}
