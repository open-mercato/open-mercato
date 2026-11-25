/**
 * Unified Workflow Definition Lookup
 *
 * Finds workflow definitions from the database first, falling back to the
 * in-memory code workflow registry. This enables code-based definitions to
 * be used seamlessly by the executor and validators.
 */

import { createHash } from 'node:crypto'
import { EntityManager } from '@mikro-orm/core'
import { WorkflowDefinition, type WorkflowDefinitionData } from '../data/entities'
import { getCodeWorkflow, getCodeWorkflowVersion } from './code-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'

const logger = createLogger('workflows')

/**
 * Workflow ids that already logged a missing pinned code version in this
 * process. Keyed by `workflowId` only, so the set can never outgrow the code
 * registry: an unregistered id returns before it is touched, and the requested
 * version — the only unbounded part — is never part of the key.
 */
const warnedMissingCodeVersionWorkflowIds = new Set<string>()

/**
 * Generate a deterministic UUID for a code workflow definition.
 * Uses SHA-256 truncated to UUID v4 format so the same workflowId always
 * produces the same UUID across restarts and horizontal replicas.
 */
export function codeWorkflowUuid(workflowId: string): string {
  const hash = createHash('sha256').update(`code-workflow:${workflowId}`).digest('hex')
  // Format as UUID v4 (set version nibble to 4, variant bits to 10xx)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${(parseInt(hash[16], 16) & 0x3 | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-')
}

/**
 * Find a workflow definition by workflowId, checking the database first
 * and falling back to the code registry.
 *
 * When a DB row exists with `codeWorkflowId` set, it means the user has
 * customized the code definition — the DB version takes precedence.
 *
 * When no DB row exists but a code definition is registered, a virtual
 * WorkflowDefinition-like object is constructed with a deterministic UUID.
 *
 * Code definitions resolve their LATEST registered version unless the caller
 * sets `allowRetainedCodeVersion`. Only trusted, definition-authored pins
 * (a SUB_WORKFLOW step's `config.version`, a workflow-level error handler's
 * `version`) may set it: a retained older version can predate approval or
 * validation steps the latest version added, so caller-supplied start input
 * (`POST /api/workflows/instances`, validate-start, AI tools) MUST NOT reach
 * it. Explicit `version` selection of DB-defined rows is unaffected.
 */
export async function findWorkflowDefinition(
  em: EntityManager,
  options: {
    workflowId: string
    version?: number
    tenantId: string
    organizationId: string
    allowRetainedCodeVersion?: boolean
  },
): Promise<WorkflowDefinition | null> {
  const { workflowId, version, tenantId, organizationId, allowRetainedCodeVersion = false } = options

  // 1. Try database first
  const where: Record<string, unknown> = {
    workflowId,
    tenantId,
    organizationId,
    deletedAt: null,
  }

  if (version !== undefined) {
    where.version = version
  }

  if (version === undefined) {
    // Unpinned resolution: latest PUBLISHED version (was "latest enabled").
    // Backfill defaulted existing rows to lifecycle='published', so behaviour is
    // identical for current data; only matters once drafts/archived rows exist.
    where.enabled = true
    where.lifecycle = 'published'
    const dbDef = await em.findOne(WorkflowDefinition, where, {
      orderBy: { version: 'DESC' },
    })
    if (dbDef) return dbDef
  } else {
    const dbDef = await em.findOne(WorkflowDefinition, where)
    if (dbDef) return dbDef
  }

  // 2. Fall back to code registry: a trusted explicit version resolves that
  // retained code version (latest + warning when it is not registered); an
  // untrusted or absent version resolves the latest.
  const codeDef = allowRetainedCodeVersion
    ? resolveCodeWorkflowVersion(workflowId, version)
    : getCodeWorkflow(workflowId)
  if (!codeDef) return null

  // When no version was requested, mirror the DB branch's `enabled = true` filter
  // so disabled code workflows aren't silently executable.
  if (version === undefined && !codeDef.enabled) return null

  return buildVirtualCodeDefinition(codeDef, tenantId, organizationId)
}

/**
 * Resolve a code workflow version: the exact retained version when `version`
 * is given and registered, otherwise the highest registered version. A pinned
 * version that is not registered (removed from code, or never retained) falls
 * back to the latest and logs one warning per `workflowId` per process.
 * Reached only by persisted instance pins and trusted definition pins.
 */
function resolveCodeWorkflowVersion(
  workflowId: string,
  version: number | null | undefined,
): CodeWorkflowDefinition | undefined {
  const latest = getCodeWorkflow(workflowId)
  if (!latest) return undefined
  if (typeof version !== 'number') return latest
  const exact = getCodeWorkflowVersion(workflowId, version)
  if (exact) return exact
  if (!warnedMissingCodeVersionWorkflowIds.has(workflowId)) {
    warnedMissingCodeVersionWorkflowIds.add(workflowId)
    logger.warn('Pinned code workflow version is not registered — falling back to the latest version', {
      workflowId,
      requestedVersion: version,
      resolvedVersion: latest.version,
    })
  }
  return latest
}

function buildVirtualCodeDefinition(
  codeDef: CodeWorkflowDefinition,
  tenantId: string,
  organizationId: string,
): WorkflowDefinition {
  // Construct a virtual WorkflowDefinition object (not persisted)
  const virtual = new WorkflowDefinition()
  virtual.id = codeWorkflowUuid(codeDef.workflowId)
  virtual.workflowId = codeDef.workflowId
  virtual.workflowName = codeDef.workflowName
  virtual.description = codeDef.description ?? null
  virtual.version = codeDef.version
  virtual.definition = codeDef.definition as WorkflowDefinitionData
  virtual.metadata = codeDef.metadata ?? null
  virtual.enabled = codeDef.enabled
  virtual.codeWorkflowId = codeDef.workflowId
  virtual.tenantId = tenantId
  virtual.organizationId = organizationId
  virtual.createdAt = new Date(0) // code defs have no creation date
  virtual.updatedAt = new Date(0)

  return virtual
}

/**
 * Resolve a virtual code definition for an already-started instance whose
 * `definitionId` does not exist in the database.
 *
 * Instances started from a virtual code definition persist the deterministic
 * `codeWorkflowUuid(workflowId)` as their `definitionId`. Runtime handlers
 * (step/transition/signal/timer/task) load definitions by that id, so without
 * this fallback an unpersisted code workflow starts but can never advance.
 *
 * The UUID equality gate ensures the fallback never substitutes the code
 * definition for a hard-deleted persisted row: those rows have their own
 * random UUIDs that can never match the deterministic code UUID.
 *
 * Every version of a code workflow shares that UUID, so the instance's
 * persisted `version` pins which retained code version it runs on. A missing
 * `version` resolves the latest; a version no longer registered falls back to
 * the latest with a once-per-workflow, per-process warning.
 */
export function resolveCodeDefinitionForInstance(instance: {
  definitionId: string
  workflowId: string
  tenantId: string
  organizationId: string
  version?: number | null
}): WorkflowDefinition | null {
  if (codeWorkflowUuid(instance.workflowId) !== instance.definitionId) return null
  const codeDef = resolveCodeWorkflowVersion(instance.workflowId, instance.version)
  if (!codeDef) return null
  return buildVirtualCodeDefinition(codeDef, instance.tenantId, instance.organizationId)
}

/**
 * Find the definition backing a workflow instance: database row by id first,
 * falling back to the in-memory code registry for instances started from an
 * unpersisted code definition.
 */
export async function findDefinitionForInstance(
  em: EntityManager,
  instance: {
    definitionId: string
    workflowId: string
    tenantId: string
    organizationId: string
    version?: number | null
  },
): Promise<WorkflowDefinition | null> {
  const dbDef = await em.findOne(WorkflowDefinition, { id: instance.definitionId })
  if (dbDef) return dbDef
  return resolveCodeDefinitionForInstance(instance)
}
