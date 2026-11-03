import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Imports a package module from the same copy the app under test runs on.
 *
 * A spec that bootstraps the app in-process (`bootstrapFromAppRoot`) and then calls into its
 * runtime — the command bus, `withAtomicFlush`, transaction lifetime — must load every one of those
 * modules from a single copy. Against a standalone app (`OM_TEST_APP_ROOT`) the app's generated
 * registries import `node_modules/@open-mercato/*` inside the app, while the spec's own static
 * imports resolve to the monorepo's packages, so module-local state such as the command registry
 * splits in two: handlers register in one copy and the bus resolves them in the other.
 *
 * Without `OM_TEST_APP_ROOT` this is a plain dynamic import, so the monorepo lane is unchanged.
 */
export async function importFromAppRuntime<TModule>(specifier: string): Promise<TModule> {
  const resolvedPath = resolveAppRuntimeModulePath(specifier)
  return (await import(resolvedPath ? pathToFileURL(resolvedPath).href : specifier)) as TModule
}

export function resolveAppRuntimeModulePath(specifier: string, appRoot = process.env.OM_TEST_APP_ROOT): string | null {
  const standaloneRoot = appRoot?.trim()
  if (!standaloneRoot) return null
  return createRequire(path.join(path.resolve(standaloneRoot), 'package.json')).resolve(specifier)
}
