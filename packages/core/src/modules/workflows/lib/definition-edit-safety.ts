/**
 * Workflows Module — Edit-safety rule for definitions with active instances (pure)
 *
 * Spec §4.1: "structural edits to a definition with active instances require a
 * new version (running instances keep executing their pinned definition
 * snapshot)… Re-pointing an edge under a running instance must be impossible,
 * not merely discouraged."
 *
 * A `WorkflowInstance` pins `definitionId` — a specific `(workflowId, version,
 * tenantId)` row — and the engine re-reads that row on every advance, so a PUT
 * that rewrites the row's `definition` JSONB changes what a running instance
 * executes mid-flight. This module answers the one question the definition PUT
 * needs before it writes: does the incoming definition change the topology the
 * engine navigates?
 *
 * Topology means the parts a mid-flight instance resolves against: which steps
 * exist and what type they are, how forks and joins pair up, and which routes
 * exist with which endpoints. Labels, descriptions, editor positions, activity
 * config, conditions, priorities, triggers and metadata are deliberately NOT
 * structural — authors must never be blocked from cosmetic or config edits.
 *
 * PURE: no ORM, no DI, no React. The caller supplies both definition documents.
 */

import type { WorkflowInstanceStatus } from '../data/entities'

/**
 * Instance statuses that still execute (or still resolve) their pinned
 * definition row. `COMPENSATING` is included: the saga walks the definition's
 * activities in reverse, so a topology rewrite corrupts it exactly like a
 * running instance. Terminal statuses (`COMPLETED`, `FAILED`, `CANCELLED`,
 * `COMPENSATED`) never read the definition again and never block an edit.
 */
export const ACTIVE_WORKFLOW_INSTANCE_STATUSES: readonly WorkflowInstanceStatus[] = [
  'RUNNING',
  'PAUSED',
  'WAITING_FOR_ACTIVITIES',
  'FORKED',
  'COMPENSATING',
]

/** Machine-readable marker on the 409 body so clients can offer "Create version". */
export const STRUCTURAL_EDIT_CONFLICT_CODE = 'WORKFLOW_STRUCTURAL_EDIT_REQUIRES_NEW_VERSION'

export type StructuralChangeKind =
  | 'stepAdded'
  | 'stepRemoved'
  | 'stepTypeChanged'
  | 'stepWiringChanged'
  | 'transitionAdded'
  | 'transitionRemoved'
  | 'transitionRetargeted'
  | 'transitionKindChanged'

export interface StructuralChange {
  kind: StructuralChangeKind
  /** `stepId` for step changes, `transitionId` for route changes. */
  id: string
}

export interface StructuralEditConflictBody {
  error: string
  code: typeof STRUCTURAL_EDIT_CONFLICT_CODE
  definitionId: string
  activeInstanceCount: number
  activeStatuses: readonly WorkflowInstanceStatus[]
  changes: StructuralChange[]
  remedy: {
    action: 'createVersion'
    method: 'POST'
    endpoint: string
  }
}

interface StepSignature {
  stepType: string
  joinStepId: string | null
  forkStepId: string | null
}

interface TransitionSignature {
  fromStepId: string
  toStepId: string
  kind: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stepSignatures(definition: unknown): Map<string, StepSignature> {
  const signatures = new Map<string, StepSignature>()
  const document = asRecord(definition)
  if (!document) return signatures

  for (const entry of asArray(document.steps)) {
    const step = asRecord(entry)
    if (!step) continue
    const stepId = readString(step, 'stepId')
    if (!stepId) continue
    const config = asRecord(step.config)
    signatures.set(stepId, {
      stepType: readString(step, 'stepType') ?? '',
      joinStepId: config ? readString(config, 'joinStepId') : null,
      forkStepId: config ? readString(config, 'forkStepId') : null,
    })
  }

  return signatures
}

function transitionSignatures(definition: unknown): Map<string, TransitionSignature> {
  const signatures = new Map<string, TransitionSignature>()
  const document = asRecord(definition)
  if (!document) return signatures

  for (const entry of asArray(document.transitions)) {
    const transition = asRecord(entry)
    if (!transition) continue
    const transitionId = readString(transition, 'transitionId')
    if (!transitionId) continue
    signatures.set(transitionId, {
      fromStepId: readString(transition, 'fromStepId') ?? '',
      toStepId: readString(transition, 'toStepId') ?? '',
      kind: readString(transition, 'kind') ?? 'normal',
    })
  }

  return signatures
}

/**
 * Diff the execution topology of two definition documents.
 *
 * Order is deterministic without sorting: step changes in `next` order, then
 * removals in `previous` order, then the same for transitions.
 */
export function diffDefinitionStructure(previous: unknown, next: unknown): StructuralChange[] {
  const changes: StructuralChange[] = []

  const previousSteps = stepSignatures(previous)
  const nextSteps = stepSignatures(next)

  for (const [stepId, signature] of nextSteps) {
    const before = previousSteps.get(stepId)
    if (!before) {
      changes.push({ kind: 'stepAdded', id: stepId })
      continue
    }
    if (before.stepType !== signature.stepType) {
      changes.push({ kind: 'stepTypeChanged', id: stepId })
      continue
    }
    if (before.joinStepId !== signature.joinStepId || before.forkStepId !== signature.forkStepId) {
      changes.push({ kind: 'stepWiringChanged', id: stepId })
    }
  }

  for (const stepId of previousSteps.keys()) {
    if (!nextSteps.has(stepId)) changes.push({ kind: 'stepRemoved', id: stepId })
  }

  const previousTransitions = transitionSignatures(previous)
  const nextTransitions = transitionSignatures(next)

  for (const [transitionId, signature] of nextTransitions) {
    const before = previousTransitions.get(transitionId)
    if (!before) {
      changes.push({ kind: 'transitionAdded', id: transitionId })
      continue
    }
    if (before.fromStepId !== signature.fromStepId || before.toStepId !== signature.toStepId) {
      changes.push({ kind: 'transitionRetargeted', id: transitionId })
      continue
    }
    if (before.kind !== signature.kind) {
      changes.push({ kind: 'transitionKindChanged', id: transitionId })
    }
  }

  for (const transitionId of previousTransitions.keys()) {
    if (!nextTransitions.has(transitionId)) {
      changes.push({ kind: 'transitionRemoved', id: transitionId })
    }
  }

  return changes
}

/** True when the incoming definition changes the topology the engine navigates. */
export function isStructuralDefinitionChange(previous: unknown, next: unknown): boolean {
  return diffDefinitionStructure(previous, next).length > 0
}

/**
 * Structured 409 body. It names the remedy explicitly so the Studio can offer a
 * one-click "Create version" instead of leaving the author with a dead end.
 */
export function buildStructuralEditConflictBody(params: {
  definitionId: string
  activeInstanceCount: number
  changes: StructuralChange[]
}): StructuralEditConflictBody {
  return {
    error: 'Structural changes require a new version while instances are still running',
    code: STRUCTURAL_EDIT_CONFLICT_CODE,
    definitionId: params.definitionId,
    activeInstanceCount: params.activeInstanceCount,
    activeStatuses: ACTIVE_WORKFLOW_INSTANCE_STATUSES,
    changes: params.changes,
    remedy: {
      action: 'createVersion',
      method: 'POST',
      endpoint: `/api/workflows/definitions/${params.definitionId}/publish`,
    },
  }
}
