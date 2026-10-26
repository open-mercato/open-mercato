/**
 * Workflows Module - Business Rule Usage Lookup
 *
 * Answers "which workflows reference this business rule?" for the dependency
 * visibility panel that ships with the inline BR editor (spec
 * 2026-07-26-workflows-ux-redesign.md team decision #5, issue #4236).
 *
 * The direction matters: `business_rules` owns the editor and exposes a slot,
 * and every consuming module resolves its OWN usage. So this lookup lives here,
 * scans workflow definitions, and never asks business_rules for anything —
 * business_rules stays free of a workflows import (core AGENTS.md §
 * Cross-Module Coupling).
 *
 * `collectBusinessRuleUsage` is PURE (plain definition JSON in, references out)
 * so it is unit-testable without a database; `findBusinessRuleUsage` is the
 * tenant-scoped query wrapper, modelled on `caller-graph.ts`.
 */

import type { EntityManager } from '@mikro-orm/core'

export type BusinessRuleUsageKind = 'startPreCondition' | 'transitionPreCondition' | 'transitionPostCondition'

export interface BusinessRuleUsageReference {
  workflowId: string
  version: number
  workflowName?: string
  kind: BusinessRuleUsageKind
  /** Step id for START pre-conditions, transition id for transition conditions. */
  locationId: string
}

export interface BusinessRuleUsageDefinition {
  workflowId: string
  version: number
  name?: string
  definition: unknown
}

function readConditionRuleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      ids.push(entry)
      continue
    }
    if (entry && typeof entry === 'object') {
      const ruleId = (entry as { ruleId?: unknown }).ruleId
      if (typeof ruleId === 'string' && ruleId.length > 0) ids.push(ruleId)
    }
  }
  return ids
}

/**
 * Every place a definition can name a business rule: START step pre-conditions
 * and transition pre/post-conditions (`data/validators.ts`
 * `startPreConditionSchema` / `transitionConditionSchema`). Inline
 * `transition.condition` expressions are NOT rule references — they are
 * embedded expressions with no rule identity — so they are deliberately absent.
 */
export function collectBusinessRuleUsage(
  definitions: BusinessRuleUsageDefinition[],
  ruleId: string,
): BusinessRuleUsageReference[] {
  if (!ruleId) return []
  const references: BusinessRuleUsageReference[] = []

  for (const candidate of definitions) {
    const data = (candidate.definition ?? {}) as { steps?: unknown; transitions?: unknown }
    const steps = Array.isArray(data.steps) ? data.steps : []
    const transitions = Array.isArray(data.transitions) ? data.transitions : []

    for (const step of steps) {
      const stepId = (step as { stepId?: unknown })?.stepId
      if (typeof stepId !== 'string') continue
      if (readConditionRuleIds((step as { preConditions?: unknown }).preConditions).includes(ruleId)) {
        references.push({
          workflowId: candidate.workflowId,
          version: candidate.version,
          ...(candidate.name ? { workflowName: candidate.name } : {}),
          kind: 'startPreCondition',
          locationId: stepId,
        })
      }
    }

    for (const transition of transitions) {
      const transitionId = (transition as { transitionId?: unknown })?.transitionId
      if (typeof transitionId !== 'string') continue
      if (readConditionRuleIds((transition as { preConditions?: unknown }).preConditions).includes(ruleId)) {
        references.push({
          workflowId: candidate.workflowId,
          version: candidate.version,
          ...(candidate.name ? { workflowName: candidate.name } : {}),
          kind: 'transitionPreCondition',
          locationId: transitionId,
        })
      }
      if (readConditionRuleIds((transition as { postConditions?: unknown }).postConditions).includes(ruleId)) {
        references.push({
          workflowId: candidate.workflowId,
          version: candidate.version,
          ...(candidate.name ? { workflowName: candidate.name } : {}),
          kind: 'transitionPostCondition',
          locationId: transitionId,
        })
      }
    }
  }

  return references
}

/** Distinct workflows (by `workflowId`) touched by the supplied references. */
export function countReferencingWorkflows(references: BusinessRuleUsageReference[]): number {
  return new Set(references.map((reference) => reference.workflowId)).size
}

/**
 * Tenant/org-scoped scan of workflow definitions for `ruleId`. Uses jsonb `@>`
 * containment (GIN-indexed on `workflow_definitions.definition`) so only rows
 * that actually name the rule are materialised, then re-checks them with the
 * pure collector to attach exact locations.
 */
export async function findBusinessRuleUsage(
  em: EntityManager,
  options: { ruleId: string; tenantId: string; organizationId: string },
): Promise<BusinessRuleUsageReference[]> {
  const { ruleId, tenantId, organizationId } = options
  if (!ruleId) return []

  const containments = [
    JSON.stringify({ steps: [{ preConditions: [{ ruleId }] }] }),
    JSON.stringify({ transitions: [{ preConditions: [{ ruleId }] }] }),
    JSON.stringify({ transitions: [{ postConditions: [{ ruleId }] }] }),
  ]

  const rows = (await em.getConnection().execute(
    `select workflow_id, version, workflow_name, definition from workflow_definitions
     where tenant_id = ? and organization_id = ? and deleted_at is null
       and (definition @> ?::jsonb or definition @> ?::jsonb or definition @> ?::jsonb)`,
    [tenantId, organizationId, ...containments],
  )) as Array<{ workflow_id: string; version: number; workflow_name: string | null; definition: unknown }>

  const definitions: BusinessRuleUsageDefinition[] = rows.map((row) => ({
    workflowId: row.workflow_id,
    version: row.version,
    ...(row.workflow_name ? { name: row.workflow_name } : {}),
    definition: typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition,
  }))

  return collectBusinessRuleUsage(definitions, ruleId)
}
