/**
 * In-Memory Code Workflow Registry (shared)
 *
 * Single process-wide store for code-based workflow definitions. Lives in
 * `@open-mercato/shared` so every runtime that bootstraps from generated data
 * (Next.js app via `bootstrap.ts`, CLI commands, and the `mercato workers`
 * process via `bootstrapFromAppRoot`) populates the same registry the
 * workflows engine reads through `@open-mercato/core`'s `code-registry`
 * bridge. Definitions live purely in memory — no DB row is created until a
 * user customizes the definition.
 */

import { createLogger } from '../../lib/logger'
import type { CodeWorkflowDefinition } from './types'

const logger = createLogger('workflows')

const codeWorkflowRegistry = new Map<string, Map<number, CodeWorkflowDefinition>>()

/**
 * Register code workflow definitions without schema validation.
 *
 * Bootstrap paths that cannot depend on the workflows module's Zod validators
 * (shared bootstrap factory, CLI/workers) register through this entry point;
 * the validating wrapper lives in
 * `@open-mercato/core/modules/workflows/lib/code-registry`.
 *
 * Every exported version of a `workflowId` is retained, keyed by `version`, so
 * in-flight instances can keep resolving the version they started on. A
 * duplicate `(workflowId, version)` is last-wins. Ownership is per
 * `workflowId`: a warning fires when an entry from a different module already
 * holds that `workflowId`.
 */
export function registerCodeWorkflowEntries(workflows: CodeWorkflowDefinition[]): void {
  for (const wf of workflows) {
    const version = resolveEntryVersion(wf)
    let versions = codeWorkflowRegistry.get(wf.workflowId)
    if (versions) {
      const foreignOwner = Array.from(versions.values()).some(
        (existing) => existing !== wf && existing.moduleId !== wf.moduleId,
      )
      if (foreignOwner) {
        logger.warn('Duplicate code workflow ID — overwriting', {
          workflowId: wf.workflowId,
          version,
          moduleId: wf.moduleId,
        })
      }
    } else {
      versions = new Map()
      codeWorkflowRegistry.set(wf.workflowId, versions)
    }
    versions.set(version, wf)
  }
}

function resolveEntryVersion(wf: CodeWorkflowDefinition): number {
  return typeof wf.version === 'number' && Number.isFinite(wf.version) ? wf.version : 1
}

function latestOf(versions: Map<number, CodeWorkflowDefinition> | undefined): CodeWorkflowDefinition | undefined {
  if (!versions || versions.size === 0) return undefined
  let latestVersion = -Infinity
  let latest: CodeWorkflowDefinition | undefined
  for (const [version, wf] of versions) {
    if (version > latestVersion) {
      latestVersion = version
      latest = wf
    }
  }
  return latest
}

/** Highest registered version of a code workflow (regardless of `enabled`). */
export function getCodeWorkflow(workflowId: string): CodeWorkflowDefinition | undefined {
  return latestOf(codeWorkflowRegistry.get(workflowId))
}

/** One exact registered version of a code workflow, or `undefined` when not retained. */
export function getCodeWorkflowVersion(workflowId: string, version: number): CodeWorkflowDefinition | undefined {
  return codeWorkflowRegistry.get(workflowId)?.get(version)
}

/** Every retained version of a code workflow, ascending by version. */
export function getCodeWorkflowVersions(workflowId: string): CodeWorkflowDefinition[] {
  const versions = codeWorkflowRegistry.get(workflowId)
  if (!versions) return []
  return Array.from(versions.entries())
    .sort(([left], [right]) => left - right)
    .map(([, wf]) => wf)
}

/** The latest version of every registered code workflow. */
export function getAllCodeWorkflows(): CodeWorkflowDefinition[] {
  const all: CodeWorkflowDefinition[] = []
  for (const versions of codeWorkflowRegistry.values()) {
    const latest = latestOf(versions)
    if (latest) all.push(latest)
  }
  return all
}

export function isCodeWorkflow(workflowId: string): boolean {
  return getCodeWorkflow(workflowId) !== undefined
}

export function clearCodeWorkflowRegistry(): void {
  codeWorkflowRegistry.clear()
}
