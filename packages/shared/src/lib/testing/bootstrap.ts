/**
 * Test Bootstrap Utility
 *
 * Provides a centralized way to bootstrap dependencies for tests.
 * This utility allows tests to register only the dependencies they need
 * without importing the full app bootstrap.
 *
 * Usage in tests:
 *
 * ```typescript
 * import { bootstrapTest, resetTestBootstrap } from '@open-mercato/shared/lib/testing/bootstrap'
 *
 * beforeEach(() => {
 *   resetTestBootstrap()
 *   bootstrapTest({
 *     modules: mockModules,
 *     entityIds: mockEntityIds,
 *   })
 * })
 * ```
 *
 * For tests that use jest.resetModules(), import dynamically:
 *
 * ```typescript
 * beforeEach(async () => {
 *   jest.resetModules()
 *   const { registerModules } = await import('@open-mercato/shared/lib/i18n/server')
 *   registerModules(mockModules as any)
 * })
 * ```
 */

import type { Module } from '../../modules/registry'

export type EntityIds = Record<string, Record<string, string>>

export interface TestBootstrapOptions {
  /** Modules to register (for i18n, query engine, etc.) */
  modules?: Module[]
  /** Entity IDs to register (for encryption, indexing) */
  entityIds?: EntityIds
  /** ORM entities to register (rarely needed in unit tests) */
  ormEntities?: any[]
  /** DI registrars to register (rarely needed in unit tests) */
  diRegistrars?: Array<(container: any) => void>
}

let _testBootstrapped = false

/**
 * Bootstrap dependencies for tests.
 * Call this in beforeEach or beforeAll to set up required registrations.
 */
export function bootstrapTest(options: TestBootstrapOptions = {}): void {
  const { modules, entityIds, ormEntities, diRegistrars } = options

  if (modules !== undefined) {
    // Import lazily to avoid circular dependencies
    const { registerModules } = require('../../i18n/server')
    registerModules(modules)
  }

  if (entityIds !== undefined) {
    const { registerEntityIds } = require('../../encryption/entityIds')
    registerEntityIds(entityIds)
  }

  if (ormEntities !== undefined) {
    const { registerOrmEntities } = require('../../db/mikro')
    registerOrmEntities(ormEntities)
  }

  if (diRegistrars !== undefined) {
    const { registerDiRegistrars } = require('../../di/container')
    registerDiRegistrars(diRegistrars)
  }

  _testBootstrapped = true
}

/**
 * Reset the test bootstrap state.
 * Call this in beforeEach when you need fresh state between tests.
 *
 * Note: This only resets the test bootstrap flag. To fully reset
 * registration state, you may need to use jest.resetModules() and
 * re-import the registration functions.
 */
export function resetTestBootstrap(): void {
  _testBootstrapped = false
}

/**
 * Check if test bootstrap has been called.
 */
export function isTestBootstrapped(): boolean {
  return _testBootstrapped
}

/**
 * Helper to create minimal mock modules for testing.
 */
export function createMockModules(overrides: Partial<Module>[] = []): Module[] {
  return overrides.map((override, index) => ({
    id: override.id || `test-module-${index}`,
    ...override,
  })) as Module[]
}

/**
 * Helper to create minimal mock entity IDs for testing.
 */
export function createMockEntityIds(
  entities: Record<string, string[]>
): EntityIds {
  const result: EntityIds = {}
  for (const [module, entityNames] of Object.entries(entities)) {
    result[module] = {}
    for (const name of entityNames) {
      result[module][name] = `${module}:${name}`
    }
  }
  return result
}
