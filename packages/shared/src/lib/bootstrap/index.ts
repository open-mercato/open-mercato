/**
 * Bootstrap module for Open Mercato applications.
 *
 * This module provides utilities for bootstrapping the application:
 *
 * - `createBootstrap(data)` - Factory to create a bootstrap function from generated data
 * - `isBootstrapped()` - Check if bootstrap has been called
 * - `resetBootstrapState()` - Reset bootstrap state (for testing)
 * - `findAppRoot()` - Find the Next.js app root directory
 *
 * For CLI/dynamic contexts, import the dynamic loader directly:
 * ```ts
 * import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
 * ```
 */

export * from './types'
export { createBootstrap, isBootstrapped, resetBootstrapState } from './factory'
export { findAppRoot, findAllApps, type AppRoot } from './appResolver'

// Note: dynamicLoader is intentionally NOT exported from index
// It should be imported directly when needed to make it clear
// that it only works in unbundled contexts (CLI, tsx)
