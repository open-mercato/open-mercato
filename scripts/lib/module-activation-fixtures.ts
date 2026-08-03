import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Activation fixtures for the two reference modules that every preset ships
 * runtime-disabled (`example` from `@app`, `design_system` from
 * `@open-mercato/core`).
 *
 * The disabled-by-default delivery contract has two halves: the presets must
 * not register either module, and each module must still work when a developer
 * explicitly enables it — without dragging the other one in. The preset half is
 * covered by `starter-preset-example-delivery.test.ts`; this module owns the
 * activation half and is driven by both the fast scaffold-level fixture test and
 * the Verdaccio scaffold smoke test.
 */

export type ModuleActivationEntry = {
  id: string
  from: string
}

export const EXAMPLE_ACTIVATION_ENTRY: ModuleActivationEntry = { id: 'example', from: '@app' }
export const DESIGN_SYSTEM_ACTIVATION_ENTRY: ModuleActivationEntry = {
  id: 'design_system',
  from: '@open-mercato/core',
}

const ENABLED_MODULES_ANCHOR = 'const enabledModules: ModuleEntry[] = ['
const GENERATED_DIR_SEGMENTS = ['.mercato', 'generated'] as const

type EntityIdRegistry = {
  moduleIds: Record<string, string>
  entityIds: Record<string, Record<string, string>>
}

type ApiRouteManifestEntry = {
  moduleId: string
  path: string
  methods: string[]
}

type InstalledDesignSystemContracts = {
  aclFeatureIds: string[]
  defaultRoleFeatures: Record<string, string[]>
  galleryRequireFeatures: string[]
  galleryRequireAuth: boolean
}

function generatedDir(appDir: string): string {
  return path.join(appDir, ...GENERATED_DIR_SEGMENTS)
}

export function modulesConfigPath(appDir: string): string {
  return path.join(appDir, 'src', 'modules.ts')
}

/**
 * Imports a module with a unique query suffix so repeated reads of the same
 * regenerated artifact are never served from the ESM module cache.
 */
async function importFresh<T>(filePath: string): Promise<T> {
  const specifier = `${pathToFileURL(filePath).href}?activation-fixture=${randomUUID()}`
  return (await import(specifier)) as T
}

/**
 * Inserts a module entry at the head of the scaffolded app's `enabledModules`
 * array literal. Fails closed when the module is already registered, because
 * that would make the activation assertions vacuous.
 */
export function enableModuleEntry(modulesTsPath: string, entry: ModuleActivationEntry): void {
  const source = fs.readFileSync(modulesTsPath, 'utf8')
  const alreadyEnabled = new RegExp(`\\{\\s*id: '${entry.id}',`).test(source)
  assert.equal(
    alreadyEnabled,
    false,
    `${modulesTsPath} already registers '${entry.id}'; the activation fixture requires it to ship disabled`,
  )

  const anchorIndex = source.indexOf(ENABLED_MODULES_ANCHOR)
  assert.notEqual(
    anchorIndex,
    -1,
    `${modulesTsPath} does not declare "${ENABLED_MODULES_ANCHOR}"; the activation fixture cannot enable '${entry.id}'`,
  )

  const insertAt = anchorIndex + ENABLED_MODULES_ANCHOR.length
  const activated = `${source.slice(0, insertAt)}\n  { id: '${entry.id}', from: '${entry.from}' },${source.slice(insertAt)}`
  fs.writeFileSync(modulesTsPath, activated)
}

export async function readEntityIdRegistry(appDir: string): Promise<EntityIdRegistry> {
  const registryPath = path.join(generatedDir(appDir), 'entities.ids.generated.ts')
  assert.ok(fs.existsSync(registryPath), `Generation did not emit ${registryPath}`)

  const registry = await importFresh<{
    M: Record<string, string>
    E: Record<string, Record<string, string>>
  }>(registryPath)

  return { moduleIds: registry.M, entityIds: registry.E }
}

export async function readApiRouteManifest(appDir: string): Promise<ApiRouteManifestEntry[]> {
  const manifestPath = path.join(generatedDir(appDir), 'api-routes.generated.ts')
  assert.ok(fs.existsSync(manifestPath), `Generation did not emit ${manifestPath}`)

  const manifest = await importFresh<{ apiRoutes: ApiRouteManifestEntry[] }>(manifestPath)
  return manifest.apiRoutes
}

export function readBackendRouteRegistrySource(appDir: string): string {
  const registryPath = path.join(generatedDir(appDir), 'modules.generated.ts')
  assert.ok(fs.existsSync(registryPath), `Generation did not emit ${registryPath}`)
  return fs.readFileSync(registryPath, 'utf8')
}

function collectGeneratedArtifactPaths(appDir: string): string[] {
  const root = generatedDir(appDir)
  if (!fs.existsSync(root)) return []

  const collected: string[] = []
  const walk = (current: string): void => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, dirent.name)
      if (dirent.isDirectory()) {
        walk(absolutePath)
        continue
      }
      if (/\.(ts|tsx|js|mjs|json|css)$/.test(dirent.name)) {
        collected.push(absolutePath)
      }
    }
  }
  walk(root)
  return collected
}

/**
 * The cross-enabling guard: enabling one reference module must leave the other
 * one completely absent from every generated artifact.
 */
export async function assertModulesUnregistered(appDir: string, moduleIds: string[]): Promise<void> {
  const { moduleIds: generatedModuleIds, entityIds } = await readEntityIdRegistry(appDir)
  const apiRoutes = await readApiRouteManifest(appDir)
  const artifactPaths = collectGeneratedArtifactPaths(appDir)

  for (const moduleId of moduleIds) {
    assert.equal(
      Object.hasOwn(generatedModuleIds, moduleId),
      false,
      `Generated module id registry must not contain '${moduleId}'`,
    )
    assert.equal(
      Object.hasOwn(entityIds, moduleId),
      false,
      `Generated entity id registry must not contain '${moduleId}'`,
    )
    assert.deepEqual(
      apiRoutes.filter((route) => route.moduleId === moduleId).map((route) => route.path),
      [],
      `Generated API route manifest must not contain routes owned by '${moduleId}'`,
    )

    const sourceNeedle = `modules/${moduleId}/`
    const leakingArtifacts = artifactPaths.filter((artifactPath) =>
      fs.readFileSync(artifactPath, 'utf8').includes(sourceNeedle),
    )
    assert.deepEqual(
      leakingArtifacts.map((artifactPath) => path.relative(appDir, artifactPath)),
      [],
      `Generated artifacts must not reference '${sourceNeedle}' while '${moduleId}' is disabled`,
    )
  }
}

function assertBackendRouteRegistered(registrySource: string, routePattern: string): void {
  assert.ok(
    registrySource.includes(`pattern: "${routePattern}"`),
    `Generated backend route registry is missing "${routePattern}"`,
  )
}

function assertBackendRouteAbsent(registrySource: string, routePattern: string): void {
  assert.equal(
    registrySource.includes(`pattern: "${routePattern}"`),
    false,
    `Generated backend route registry must not expose "${routePattern}"`,
  )
}

/**
 * Proves the `example` module works when a developer enables it in a generated
 * app: the Todo entity id is emitted, the Todo list/create/edit pages and the
 * Todo CRUD API surface are registered, and the ACL features those pages guard
 * on exist — without registering `design_system`.
 */
export async function assertExampleActivation(appDir: string): Promise<void> {
  const { moduleIds, entityIds } = await readEntityIdRegistry(appDir)

  assert.equal(entityIds.example?.todo, 'example:todo')
  assert.equal(moduleIds.example, 'example')

  // Only the presets whose modules.ts carries the companion conditional may pull
  // example_customers_sync in; the others must stay untouched by the activation.
  const declaresCompanion = fs
    .readFileSync(modulesConfigPath(appDir), 'utf8')
    .includes(`{ id: 'example_customers_sync', from: '@app' }`)
  if (declaresCompanion) {
    assert.equal(
      moduleIds.example_customers_sync,
      'example_customers_sync',
      'Enabling example must pull in its example_customers_sync companion (src/modules.ts conditional)',
    )
  } else {
    await assertModulesUnregistered(appDir, ['example_customers_sync'])
  }

  const registrySource = readBackendRouteRegistrySource(appDir)
  assertBackendRouteRegistered(registrySource, '/backend/todos')
  assertBackendRouteRegistered(registrySource, '/backend/todos/create')
  assertBackendRouteRegistered(registrySource, '/backend/todos/[id]/edit')

  const apiRoutes = await readApiRouteManifest(appDir)
  const todosRoute = apiRoutes.find((route) => route.path === '/example/todos')
  assert.ok(todosRoute, 'Generated API route manifest is missing /example/todos')
  assert.equal(todosRoute.moduleId, 'example')
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    assert.ok(
      todosRoute.methods.includes(method),
      `/example/todos must expose ${method}; got ${todosRoute.methods.join(', ')}`,
    )
  }

  const aclPath = path.join(appDir, 'src', 'modules', 'example', 'acl.ts')
  assert.ok(fs.existsSync(aclPath), `Activated example module is missing ${aclPath}`)
  const acl = await importFresh<{ features: { id: string }[] }>(aclPath)
  const featureIds = acl.features.map((feature) => feature.id)
  for (const featureId of ['example.todos.view', 'example.todos.manage']) {
    assert.ok(featureIds.includes(featureId), `Example ACL must declare '${featureId}'`)
  }

  assertBackendRouteAbsent(registrySource, '/backend/design-system')
  await assertModulesUnregistered(appDir, ['design_system'])
}

function resolveInstalledCoreModuleFile(appDir: string, relativePath: string): string {
  const moduleRoot = path.join(appDir, 'node_modules', '@open-mercato', 'core')
  const candidates = [
    path.join(moduleRoot, 'dist', 'modules', 'design_system', `${relativePath}.js`),
    path.join(moduleRoot, 'src', 'modules', 'design_system', `${relativePath}.ts`),
  ]
  const resolved = candidates.find((candidate) => fs.existsSync(candidate))
  assert.ok(
    resolved,
    `Installed @open-mercato/core does not ship design_system/${relativePath}; looked in ${candidates.join(' and ')}`,
  )
  return resolved
}

async function readInstalledDesignSystemContracts(appDir: string): Promise<InstalledDesignSystemContracts> {
  const acl = await importFresh<{ features: { id: string }[] }>(
    resolveInstalledCoreModuleFile(appDir, 'acl'),
  )
  const setup = await importFresh<{ setup: { defaultRoleFeatures: Record<string, string[]> } }>(
    resolveInstalledCoreModuleFile(appDir, 'setup'),
  )
  const pageMeta = await importFresh<{ metadata: { requireAuth: boolean; requireFeatures: string[] } }>(
    resolveInstalledCoreModuleFile(appDir, path.join('backend', 'design-system', 'page.meta')),
  )

  return {
    aclFeatureIds: acl.features.map((feature) => feature.id),
    defaultRoleFeatures: setup.setup.defaultRoleFeatures,
    galleryRequireFeatures: pageMeta.metadata.requireFeatures,
    galleryRequireAuth: pageMeta.metadata.requireAuth,
  }
}

/**
 * Proves the `design_system` module works when a developer enables it in a
 * generated app: the gallery route is registered, `design_system.view` is
 * declared and granted by module setup, and the gallery is guarded by it —
 * without registering `example`.
 */
export async function assertDesignSystemActivation(appDir: string): Promise<void> {
  const { moduleIds } = await readEntityIdRegistry(appDir)
  assert.equal(moduleIds.design_system, 'design_system')

  const registrySource = readBackendRouteRegistrySource(appDir)
  assertBackendRouteRegistered(registrySource, '/backend/design-system')
  for (const importPath of [
    '@open-mercato/core/modules/design_system/index',
    '@open-mercato/core/modules/design_system/acl',
    '@open-mercato/core/modules/design_system/setup',
  ]) {
    assert.ok(
      registrySource.includes(importPath),
      `Generated module registry is missing the '${importPath}' import`,
    )
  }

  const contracts = await readInstalledDesignSystemContracts(appDir)
  assert.ok(
    contracts.aclFeatureIds.includes('design_system.view'),
    `design_system ACL must declare 'design_system.view'; got ${contracts.aclFeatureIds.join(', ')}`,
  )
  assert.ok(
    contracts.defaultRoleFeatures.admin?.includes('design_system.view'),
    'design_system setup must grant design_system.view to the admin role',
  )
  assert.equal(contracts.galleryRequireAuth, true)
  assert.deepEqual(contracts.galleryRequireFeatures, ['design_system.view'])

  assertBackendRouteAbsent(registrySource, '/backend/todos')
  await assertModulesUnregistered(appDir, ['example', 'example_customers_sync'])
}

export type ActivationFixtureOptions = {
  appDir: string
  entry: ModuleActivationEntry
  generate: () => Promise<void> | void
  assertActivation: (appDir: string) => Promise<void>
  log?: (message: string) => void
}

/**
 * Enables one module in a generated app, regenerates, runs the activation
 * assertions and always restores the app to its shipped (disabled) baseline so
 * a later fixture — or an interactive shell handed to the developer — never
 * inherits the previous fixture's module set.
 */
export async function runActivationFixture(options: ActivationFixtureOptions): Promise<void> {
  const log = options.log ?? (() => {})
  const configPath = modulesConfigPath(options.appDir)
  assert.ok(fs.existsSync(configPath), `Generated app is missing ${configPath}`)
  const baselineSource = fs.readFileSync(configPath, 'utf8')

  log(`Activation fixture: enabling '${options.entry.id}' from '${options.entry.from}'`)
  try {
    enableModuleEntry(configPath, options.entry)
    await options.generate()
    await options.assertActivation(options.appDir)
    log(`Activation fixture passed for '${options.entry.id}'`)
  } finally {
    fs.writeFileSync(configPath, baselineSource)
    try {
      await options.generate()
    } catch (error) {
      log(
        `Failed to regenerate the disabled baseline after the '${options.entry.id}' fixture: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
