import type { BootstrapData } from './types'
import { findAppRoot, type AppRoot } from './appResolver'
import { registerEntityIds } from '../encryption/entityIds'
import {
  ensureMikroOrmV7GeneratedCacheCompatibility,
  recoverMikroOrmV7GeneratedCacheFromImportError,
} from './generatedCacheRecovery'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Compile a TypeScript file to JavaScript using esbuild bundler.
 * This bundles the file and all its dependencies, handling JSON imports properly.
 * The compiled file is written next to the source file with a .mjs extension.
 */
async function compileAndImport(tsPath: string, allowRecovery: boolean = true): Promise<Record<string, unknown>> {
  const jsPath = tsPath.replace(/\.ts$/, '.mjs')
  const appRoot = path.dirname(path.dirname(path.dirname(tsPath)))

  // Check if we need to recompile (source newer than compiled)
  const tsExists = fs.existsSync(tsPath)
  const jsExists = fs.existsSync(jsPath)

  if (!tsExists) {
    throw new Error(`Generated file not found: ${tsPath}`)
  }

  const needsCompile = !jsExists ||
    fs.statSync(tsPath).mtimeMs > fs.statSync(jsPath).mtimeMs

  if (needsCompile) {
    // Dynamically import esbuild only when needed
    const esbuild = await import('esbuild')

    // Plugin to resolve @/ alias to app root (works for @app modules)
    const aliasPlugin: import('esbuild').Plugin = {
      name: 'alias-resolver',
      setup(build) {
        // Resolve @/ alias to app root
        build.onResolve({ filter: /^@\// }, (args) => {
          const resolved = path.join(appRoot, args.path.slice(2))
          // Try with .ts extension if base path doesn't exist
          if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.ts')) {
            return { path: resolved + '.ts' }
          }
          // Also check for /index.ts if it's a directory
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() && fs.existsSync(path.join(resolved, 'index.ts'))) {
            return { path: path.join(resolved, 'index.ts') }
          }
          return { path: resolved }
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

    // Use esbuild.build with bundling to handle JSON imports
    await esbuild.build({
      entryPoints: [tsPath],
      outfile: jsPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      plugins: [aliasPlugin, externalNonJsonPlugin],
      // Allow JSON imports
      loader: { '.json': 'json' },
    })
  }

  // Import the compiled JavaScript
  try {
    const fileUrl = `${pathToFileURL(jsPath).href}?mtime=${fs.statSync(jsPath).mtimeMs}`
    return import(fileUrl)
  } catch (error) {
    if (!allowRecovery) {
      throw error
    }

    const recovered = recoverMikroOrmV7GeneratedCacheFromImportError(appRoot, error)
    if (!recovered.applied) {
      throw error
    }

    return compileAndImport(tsPath, false)
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
export async function loadBootstrapData(appRoot?: string): Promise<BootstrapData> {
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
  ] = await Promise.all([
    compileAndImport(path.join(generatedDir, 'modules.cli.generated.ts')),
    compileAndImport(path.join(generatedDir, 'entities.generated.ts')),
    compileAndImport(path.join(generatedDir, 'di.generated.ts')),
    compileAndImport(path.join(generatedDir, 'search.generated.ts')).catch(() => ({ searchModuleConfigs: [] })),
    compileAndImport(path.join(generatedDir, 'command-loaders.generated.ts')).catch(() => ({ commandLoaderEntries: [] })),
  ])

  return {
    modules: modulesModule.modules as BootstrapData['modules'],
    entities: entitiesModule.entities as BootstrapData['entities'],
    diRegistrars: diModule.diRegistrars as BootstrapData['diRegistrars'],
    entityIds: entityIdsModule.E as BootstrapData['entityIds'],
    // Search configs are needed by workers for indexing
    searchModuleConfigs: (searchModule.searchModuleConfigs ?? []) as BootstrapData['searchModuleConfigs'],
    commandLoaderEntries: (commandLoadersModule.commandLoaderEntries ?? []) as BootstrapData['commandLoaderEntries'],
    // Empty UI-related data - not needed for CLI
    dashboardWidgetEntries: [],
    injectionWidgetEntries: [],
    injectionTables: [],
    interceptorEntries: [],
    componentOverrideEntries: [],
  }
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
  const data = await loadBootstrapData(appRoot)
  const bootstrap = createBootstrap(data)
  bootstrap()
  // In CLI context, wait for async registrations (UI widgets, search configs, etc.)
  await waitForAsyncRegistration()

  return data
}

type GeneratedImport = Record<string, unknown>

async function loadGeneratedExport(
  generatedDir: string,
  fileName: string,
  exportName: string,
  fallback: unknown = undefined,
): Promise<unknown> {
  try {
    const mod = await compileAndImport(path.join(generatedDir, fileName))
    return mod[exportName] ?? fallback
  } catch {
    return fallback
  }
}

export type IntrospectionBootstrapData = BootstrapData & {
  eventModuleConfigs: unknown[]
  notificationTypes: unknown[]
  messageTypes: unknown[]
  messageObjectTypes: unknown[]
  aiToolConfigEntries: Array<{ moduleId: string; tools: unknown[] }>
  codeWorkflows: unknown[]
  runBootstrapRegistrations: (() => void) | null
}

export type IntrospectionBootstrapLoadOptions = {
  requiredFiles?: import('../introspection/surface-bootstrap-deps').IntrospectionBootstrapFile[]
}

function shouldLoadFile(
  file: import('../introspection/surface-bootstrap-deps').IntrospectionBootstrapFile,
  requiredFiles: Set<import('../introspection/surface-bootstrap-deps').IntrospectionBootstrapFile> | null,
): boolean {
  return requiredFiles === null || requiredFiles.has(file)
}

/**
 * Load registry data for platform introspection (CLI / dev tooling).
 * When `requiredFiles` is set, only the generated dictionaries needed for the
 * requested surfaces are compiled/imported.
 */
export async function loadIntrospectionBootstrapData(
  appRoot?: string,
  options: IntrospectionBootstrapLoadOptions = {},
): Promise<IntrospectionBootstrapData> {
  const base = await loadBootstrapData(appRoot)
  const resolved = appRoot
    ? path.join(appRoot, '.mercato', 'generated')
    : findAppRoot()?.generatedDir

  if (!resolved) {
    throw new Error('[internal] Could not resolve generated directory for introspection bootstrap')
  }

  const requiredFiles = options.requiredFiles
    ? new Set(options.requiredFiles)
    : null

  const loadOptional = <T>(
    file: import('../introspection/surface-bootstrap-deps').IntrospectionBootstrapFile,
    loader: () => Promise<T>,
    fallback: T,
  ): Promise<T> => (shouldLoadFile(file, requiredFiles) ? loader() : Promise.resolve(fallback))

  const [
    modulesAppModule,
    eventModuleConfigs,
    notificationTypes,
    messageTypes,
    messageObjectTypes,
    aiToolConfigEntries,
    codeWorkflows,
    dashboardWidgetEntries,
    injectionWidgetEntries,
    injectionTables,
    enricherEntries,
    interceptorEntries,
    componentOverrideEntries,
    guardEntries,
    commandInterceptorEntries,
    notificationHandlerEntries,
    analyticsModuleConfigs,
    bootstrapRegsModule,
  ] = await Promise.all([
    loadOptional('modulesApp', () => compileAndImport(path.join(resolved, 'modules.app.generated.ts')), { modules: base.modules }),
    loadOptional('events', () => loadGeneratedExport(resolved, 'events.generated.ts', 'eventModuleConfigs', []), []),
    loadOptional('notifications', () => loadGeneratedExport(resolved, 'notifications.generated.ts', 'notificationTypes', []), []),
    loadOptional('messageTypes', () => loadGeneratedExport(resolved, 'message-types.generated.ts', 'messageTypes', []), []),
    loadOptional('messageObjectTypes', () => loadGeneratedExport(resolved, 'message-objects.generated.ts', 'messageObjectTypes', []), []),
    loadOptional('aiTools', () => loadGeneratedExport(resolved, 'ai-tools.generated.ts', 'aiToolConfigEntries', []), []),
    loadOptional('workflows', () => loadGeneratedExport(resolved, 'workflows.generated.ts', 'allCodeWorkflows', []), []),
    loadOptional('dashboardWidgets', () => loadGeneratedExport(resolved, 'dashboard-widgets.generated.ts', 'dashboardWidgetEntries', []), []),
    loadOptional('injectionWidgets', () => loadGeneratedExport(resolved, 'injection-widgets.generated.ts', 'injectionWidgetEntries', []), []),
    loadOptional('injectionTables', () => loadGeneratedExport(resolved, 'injection-tables.generated.ts', 'injectionTables', []), []),
    loadOptional('enrichers', () => loadGeneratedExport(resolved, 'enrichers.generated.ts', 'enricherEntries', []), []),
    loadOptional('interceptors', () => loadGeneratedExport(resolved, 'interceptors.generated.ts', 'interceptorEntries', []), []),
    loadOptional('componentOverrides', () => loadGeneratedExport(resolved, 'component-overrides.generated.ts', 'componentOverrideEntries', []), []),
    loadOptional('guards', () => loadGeneratedExport(resolved, 'guards.generated.ts', 'guardEntries', []), []),
    loadOptional('commandInterceptors', () => loadGeneratedExport(resolved, 'command-interceptors.generated.ts', 'commandInterceptorEntries', []), []),
    loadOptional('notificationHandlers', () => loadGeneratedExport(resolved, 'notification-handlers.generated.ts', 'notificationHandlerEntries', []), []),
    loadOptional('analytics', () => loadGeneratedExport(resolved, 'analytics.generated.ts', 'analyticsModuleConfigs', []), []),
    loadOptional('bootstrapRegistrations', () => compileAndImport(path.join(resolved, 'bootstrap-registrations.generated.ts')), null),
  ])

  const appModules = (modulesAppModule as GeneratedImport).modules as BootstrapData['modules'] | undefined

  return {
    ...base,
    modules: appModules ?? base.modules,
    dashboardWidgetEntries: (dashboardWidgetEntries as BootstrapData['dashboardWidgetEntries']) ?? [],
    injectionWidgetEntries: (injectionWidgetEntries as BootstrapData['injectionWidgetEntries']) ?? [],
    injectionTables: (injectionTables as BootstrapData['injectionTables']) ?? [],
    enricherEntries: (enricherEntries as BootstrapData['enricherEntries']) ?? [],
    interceptorEntries: (interceptorEntries as BootstrapData['interceptorEntries']) ?? [],
    componentOverrideEntries: (componentOverrideEntries as BootstrapData['componentOverrideEntries']) ?? [],
    guardEntries: (guardEntries as BootstrapData['guardEntries']) ?? [],
    commandInterceptorEntries: (commandInterceptorEntries as BootstrapData['commandInterceptorEntries']) ?? [],
    notificationHandlerEntries: (notificationHandlerEntries as BootstrapData['notificationHandlerEntries']) ?? [],
    analyticsModuleConfigs: (analyticsModuleConfigs as BootstrapData['analyticsModuleConfigs']) ?? [],
    eventModuleConfigs: (eventModuleConfigs as unknown[]) ?? [],
    notificationTypes: (notificationTypes as unknown[]) ?? [],
    messageTypes: (messageTypes as unknown[]) ?? [],
    messageObjectTypes: (messageObjectTypes as unknown[]) ?? [],
    aiToolConfigEntries: (aiToolConfigEntries as IntrospectionBootstrapData['aiToolConfigEntries']) ?? [],
    codeWorkflows: (codeWorkflows as unknown[]) ?? [],
    runBootstrapRegistrations:
      bootstrapRegsModule && typeof (bootstrapRegsModule as GeneratedImport).runBootstrapRegistrations === 'function'
        ? ((bootstrapRegsModule as GeneratedImport).runBootstrapRegistrations as () => void)
        : null,
  }
}
