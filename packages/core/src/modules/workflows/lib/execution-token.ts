/**
 * Workflows Module - Execution Token Abstraction
 *
 * An execution token is the cursor the engine advances: it holds a
 * `currentStepId`, a read/write context scope, a status, and an optional
 * pending async transition. Today there are two kinds:
 *
 *  - **root token** — backed directly by the `WorkflowInstance`. Used for all
 *    single-token (FORK-less) execution. Every accessor maps 1:1 onto the
 *    instance fields, so the legacy single-token path is behaviourally
 *    unchanged.
 *  - **branch token** — backed by a `WorkflowBranchInstance` created by a
 *    PARALLEL_FORK. The branch shares the parent instance's identity (id,
 *    definition, tenant/org) for step-instance/event scoping, but owns its own
 *    `currentStepId`, private context namespace, status and pending transition.
 *
 * The handlers operate on tokens via these functional accessors so the same
 * step/transition logic serves both kinds.
 */

import type {
  WorkflowInstance,
  WorkflowBranchInstance,
} from '../data/entities'

export interface PendingTransitionState {
  toStepId: string
  activityResults: any[]
  timestamp: Date
}

export type ExecutionToken =
  | { kind: 'root'; instance: WorkflowInstance }
  | { kind: 'branch'; instance: WorkflowInstance; branch: WorkflowBranchInstance }

/** Build a root token backed by the instance (single-token execution). */
export function rootToken(instance: WorkflowInstance): ExecutionToken {
  return { kind: 'root', instance }
}

/** Build a branch token backed by a branch instance of the given parent. */
export function branchToken(
  instance: WorkflowInstance,
  branch: WorkflowBranchInstance,
): ExecutionToken {
  return { kind: 'branch', instance, branch }
}

// ---------------------------------------------------------------------------
// Identity (shared between root and branch — step instances and events are
// always scoped to the parent WorkflowInstance, tagged with branchInstanceId).
// ---------------------------------------------------------------------------

export function tokenInstanceId(token: ExecutionToken): string {
  return token.instance.id
}

export function tokenDefinitionId(token: ExecutionToken): string {
  return token.instance.definitionId
}

export function tokenTenantId(token: ExecutionToken): string {
  return token.instance.tenantId
}

export function tokenOrganizationId(token: ExecutionToken): string {
  return token.instance.organizationId
}

/** The branch id this token represents, or null for the root token. */
export function tokenBranchInstanceId(token: ExecutionToken): string | null {
  return token.kind === 'branch' ? token.branch.id : null
}

// ---------------------------------------------------------------------------
// Cursor + context
// ---------------------------------------------------------------------------

export function tokenCurrentStepId(token: ExecutionToken): string {
  return token.kind === 'branch' ? token.branch.currentStepId : token.instance.currentStepId
}

export function setTokenCurrentStepId(token: ExecutionToken, stepId: string): void {
  if (token.kind === 'branch') token.branch.currentStepId = stepId
  else token.instance.currentStepId = stepId
}

/**
 * Effective read context: for a branch this is the instance context (snapshot)
 * overlaid with the branch's private namespace, so a branch sees fork-time
 * instance state plus its own writes. For the root it is the instance context.
 */
export function tokenReadContext(token: ExecutionToken): Record<string, any> {
  if (token.kind === 'branch') {
    return { ...(token.instance.context || {}), ...(token.branch.contextNamespace || {}) }
  }
  return token.instance.context || {}
}

/**
 * Apply context writes after a transition. The root path is identical to the
 * legacy behaviour: merge the passed workflowContext and activity outputs into
 * `instance.context`. A branch writes only activity outputs (and any explicit
 * deltas the caller already folded into its namespace) into its private
 * namespace, never the shared instance snapshot — this prevents cross-branch
 * key collisions.
 */
export function applyTokenContextWrites(
  token: ExecutionToken,
  workflowContext: Record<string, any>,
  activityOutputs: Record<string, any>,
): void {
  if (token.kind === 'branch') {
    token.branch.contextNamespace = {
      ...(token.branch.contextNamespace || {}),
      ...activityOutputs,
    }
    return
  }
  token.instance.context = {
    ...(token.instance.context || {}),
    ...workflowContext,
    ...activityOutputs,
  }
}

// ---------------------------------------------------------------------------
// Status / pause state machine
// ---------------------------------------------------------------------------

export function setTokenWaitingForActivities(token: ExecutionToken): void {
  if (token.kind === 'branch') token.branch.status = 'WAITING_FOR_ACTIVITIES'
  else token.instance.status = 'WAITING_FOR_ACTIVITIES'
}

export function setTokenPaused(token: ExecutionToken, at: Date): void {
  if (token.kind === 'branch') {
    token.branch.status = 'PAUSED'
  } else {
    token.instance.status = 'PAUSED'
    token.instance.pausedAt = at
  }
}

export function getTokenPendingTransition(token: ExecutionToken): PendingTransitionState | null {
  return (token.kind === 'branch' ? token.branch.pendingTransition : token.instance.pendingTransition) ?? null
}

export function setTokenPendingTransition(token: ExecutionToken, pending: PendingTransitionState | null): void {
  if (token.kind === 'branch') token.branch.pendingTransition = pending
  else token.instance.pendingTransition = pending
}

export function touchToken(token: ExecutionToken, now: Date): void {
  if (token.kind === 'branch') token.branch.updatedAt = now
  else token.instance.updatedAt = now
}

/** Merge a patch into the token's own write scope (instance.context or branch namespace). */
export function mergeTokenContext(token: ExecutionToken, patch: Record<string, any>): void {
  if (token.kind === 'branch') {
    token.branch.contextNamespace = { ...(token.branch.contextNamespace || {}), ...patch }
  } else {
    token.instance.context = { ...(token.instance.context || {}), ...patch }
  }
}
