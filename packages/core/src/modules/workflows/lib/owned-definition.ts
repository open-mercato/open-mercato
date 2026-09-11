import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  WorkflowDefinition,
  type WorkflowDefinitionData,
  type WorkflowMetadata,
} from '../data/entities'
import { normalizeGrantedFeatures, syncWorkflowDefinitionPrincipal } from './definition-grant'
import { invalidateTriggerCache } from './event-trigger-service'

/**
 * Create-or-update of a workflow definition that ANOTHER module authors and owns.
 *
 * The point of this service is that there is exactly one workflow engine and one
 * kind of workflow definition. When a module offers a simplified way to express a
 * process — "run this agent every morning" — the right answer is to generate a
 * real definition here, not to build a parallel executor for the simple case. The
 * generated row is an ordinary `WorkflowDefinition`: it shows up in the Studio,
 * it can be opened and extended by hand, and it runs through the same engine with
 * the same retry, wait, signal and cancellation semantics as anything else.
 *
 * Ownership is recorded in `metadata.generatedBy` and re-checked on every write,
 * so this can never silently take over a workflow a person authored or one
 * belonging to a different owner.
 *
 * Execution identity comes with it: `grantedFeatures` is applied through the same
 * `syncWorkflowDefinitionPrincipal` the definitions API uses, so a generated
 * workflow runs as its own least-privilege principal exactly like a hand-authored
 * one. AUTHORIZING that grant is the caller's job — this service is a write
 * primitive, not a permission boundary.
 */

export type OwnedWorkflowDefinitionInput = {
  ownerModule: string
  ownerId: string
  workflowId: string
  workflowName: string
  description?: string | null
  definition: WorkflowDefinitionData
  metadata?: Omit<WorkflowMetadata, 'generatedBy'> | null
  grantedFeatures?: string[] | null
  enabled?: boolean
  tenantId: string
  organizationId: string
  actorUserId?: string | null
}

export type OwnedWorkflowDefinitionResult =
  | { ok: true; definition: WorkflowDefinition; created: boolean }
  | { ok: false; reason: 'owned_by_other'; definition: WorkflowDefinition }

export interface WorkflowDefinitionAuthoring {
  upsertOwnedDefinition(
    em: EntityManager,
    input: OwnedWorkflowDefinitionInput,
  ): Promise<OwnedWorkflowDefinitionResult>
  findOwnedDefinition(
    em: EntityManager,
    params: { workflowId: string; tenantId: string; organizationId: string },
  ): Promise<WorkflowDefinition | null>
  /** Batch form for a list page: one query for a page of workflow ids. */
  findDefinitionsByWorkflowIds(
    em: EntityManager,
    params: { workflowIds: string[]; tenantId: string; organizationId: string },
  ): Promise<WorkflowDefinition[]>
  deleteOwnedDefinition(
    em: EntityManager,
    params: { workflowId: string; ownerModule: string; ownerId: string; tenantId: string; organizationId: string },
  ): Promise<boolean>
}

function ownedBy(definition: WorkflowDefinition, ownerModule: string, ownerId: string): boolean {
  const generatedBy = definition.metadata?.generatedBy
  return !!generatedBy && generatedBy.module === ownerModule && generatedBy.ownerId === ownerId
}

export function createWorkflowDefinitionAuthoring(container: AwilixContainer): WorkflowDefinitionAuthoring {
  return {
    async findOwnedDefinition(em, params) {
      return em.findOne(
        WorkflowDefinition,
        {
          workflowId: params.workflowId,
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          deletedAt: null,
        },
        { orderBy: { version: 'DESC' } },
      )
    },

    async findDefinitionsByWorkflowIds(em, params) {
      if (params.workflowIds.length === 0) return []
      return em.find(
        WorkflowDefinition,
        {
          workflowId: { $in: params.workflowIds },
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          deletedAt: null,
        },
        { orderBy: { version: 'DESC' } },
      )
    },

    async upsertOwnedDefinition(em, input) {
      const grantedFeatures = normalizeGrantedFeatures(input.grantedFeatures)
      const existing = await em.findOne(
        WorkflowDefinition,
        {
          workflowId: input.workflowId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
        { orderBy: { version: 'DESC' } },
      )

      // A row that exists but belongs to someone else — a person's own workflow,
      // or another owner's — is never overwritten. The caller decides what to do
      // about it; silently replacing a hand-authored graph would be the worst
      // possible failure mode of a convenience feature.
      if (existing && !ownedBy(existing, input.ownerModule, input.ownerId)) {
        return { ok: false, reason: 'owned_by_other', definition: existing }
      }

      const metadata: WorkflowMetadata = {
        ...(input.metadata ?? {}),
        generatedBy: { module: input.ownerModule, ownerId: input.ownerId },
      }

      const definition =
        existing ??
        em.create(WorkflowDefinition, {
          // The PK is minted up front (MikroORM does not generate UUIDs
          // client-side) so the execution principal — whose identity key is the
          // definition id — can be provisioned BEFORE the row claiming the grant
          // is persisted.
          id: randomUUID(),
          workflowId: input.workflowId,
          workflowName: input.workflowName,
          version: 1,
          definition: input.definition,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          createdBy: input.actorUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

      definition.workflowName = input.workflowName
      definition.description = input.description ?? null
      definition.definition = input.definition
      definition.metadata = metadata
      definition.enabled = input.enabled ?? true
      definition.grantedFeatures = grantedFeatures.length ? grantedFeatures : null
      definition.updatedBy = input.actorUserId ?? definition.updatedBy ?? null
      definition.updatedAt = new Date()

      await syncWorkflowDefinitionPrincipal(container, definition)
      em.persist(definition)
      await em.flush()

      // Embedded triggers on a freshly written definition must be visible to the
      // wildcard event subscriber immediately.
      invalidateTriggerCache(input.tenantId, input.organizationId)

      return { ok: true, definition, created: !existing }
    },

    async deleteOwnedDefinition(em, params) {
      const existing = await em.findOne(WorkflowDefinition, {
        workflowId: params.workflowId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        deletedAt: null,
      })
      if (!existing) return false
      if (!ownedBy(existing, params.ownerModule, params.ownerId)) return false
      existing.deletedAt = new Date()
      em.persist(existing)
      await em.flush()
      invalidateTriggerCache(params.tenantId, params.organizationId)
      return true
    },
  }
}
