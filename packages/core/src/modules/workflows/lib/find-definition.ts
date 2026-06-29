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
import { getCodeWorkflow } from './code-registry'

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
 */
export async function findWorkflowDefinition(
  em: EntityManager,
  options: {
    workflowId: string
    version?: number
    tenantId: string
    organizationId: string
  },
): Promise<WorkflowDefinition | null> {
  const { workflowId, version, tenantId, organizationId } = options

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
    where.enabled = true
    const dbDef = await em.findOne(WorkflowDefinition, where, {
      orderBy: { version: 'DESC' },
    })
    if (dbDef) return dbDef
  } else {
    const dbDef = await em.findOne(WorkflowDefinition, where)
    if (dbDef) return dbDef
  }

  // 2. Fall back to code registry (version filter not applicable to code defs)
  const codeDef = getCodeWorkflow(workflowId)
  if (!codeDef) return null

  // When no version was requested, mirror the DB branch's `enabled = true` filter
  // so disabled code workflows aren't silently executable.
  if (version === undefined && !codeDef.enabled) return null

  // Construct a virtual WorkflowDefinition object (not persisted)
  const virtual = new WorkflowDefinition()
  virtual.id = codeWorkflowUuid(workflowId)
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
