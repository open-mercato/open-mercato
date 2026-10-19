import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  normalizeFeatureList,
  provisionExecutionPrincipal,
  resolveExecutionPrincipalUserId,
} from '../../auth/lib/executionPrincipal'

/**
 * Workflow execution identity (`grantedFeatures`).
 *
 * A workflow needs an acting user to write anything: `executeUpdateEntity`
 * refuses without one and then checks that user's LIVE features against the
 * command's `requiredFeatures`. Historically that user was whoever started the
 * run — so a workflow started by an admin silently ran with admin powers, and an
 * event-triggered run (whose `initiatedBy` is `trigger:<id>`) had no actor at
 * all and could not write.
 *
 * A definition may instead declare its own least-privilege grant. Two rules,
 * both deliberate:
 *
 *  - **No grant ⇒ today's behaviour, byte-for-byte.** The run borrows the
 *    starting user's identity. The feature is additive and opt-in; every
 *    pre-existing definition is unaffected.
 *  - **A grant ⇒ the run ALWAYS acts as its own principal**, regardless of who
 *    started it. That is the point: the grant is a ceiling, not a floor, so a
 *    run started by an admin must not gain the admin's powers. It also gives the
 *    no-actor triggered case a real identity.
 *
 * The grant lives on the definition ROW (a real column), so it is per version:
 * publishing a new version mints a new row, hence a new principal, hence a
 * re-authorised grant.
 */

/** The `auth` execution-principal namespace this module owns. */
export function workflowPrincipalKey(definitionId: string): string {
  return `workflow:${definitionId}`
}

export function normalizeGrantedFeatures(value: unknown): string[] {
  return normalizeFeatureList(value)
}

export type WorkflowDefinitionGrantLike = {
  id: string
  tenantId: string
  organizationId: string
  workflowId?: string
  grantedFeatures?: string[] | null
}

export function definitionDeclaresGrant(definition: WorkflowDefinitionGrantLike | null | undefined): boolean {
  return normalizeGrantedFeatures(definition?.grantedFeatures).length > 0
}

/**
 * The features in `requested` that `granted` does not cover.
 *
 * Wildcard-aware on purpose: `workflows.*` in the author's own grants satisfies
 * `workflows.definitions.view` in the request, and a plain `includes()` would
 * refuse a grant the author demonstrably holds. Uses the shared matcher so this
 * agrees with every other ACL decision in the platform.
 */
export function findUngrantableFeatures(requested: string[], granted: string[]): string[] {
  return normalizeGrantedFeatures(requested).filter((feature) => !hasFeature(granted, feature))
}

export const WORKFLOW_GRANT_FEATURE = 'workflows.definitions.grant_features'

export type WorkflowGrantAuthorizationFailure = {
  status: number
  body: {
    error: string
    code: 'WORKFLOW_GRANT_FEATURE_REQUIRED' | 'WORKFLOW_GRANT_EXCEEDS_GRANTOR_FEATURES'
    details?: { missingFeatures: string[] }
  }
}

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

/**
 * Authorises a change to a definition's grant. Returns null when the change is
 * allowed, otherwise the response body/status the route should return.
 *
 * Two gates, both required:
 *  1. `workflows.definitions.grant_features` — declaring an execution identity
 *     is not implied by ordinary `definitions.edit`.
 *  2. The requested grant must be a SUBSET of the saving user's own current
 *     features. `userHasAllFeatures` is the authority (it is the same primitive
 *     every other route uses, so it honours super-admin, wildcards, module
 *     enablement and organization visibility identically); the missing-feature
 *     list in the error body is derived with the shared wildcard-aware matcher,
 *     never `includes()`.
 *
 * A no-op change (`requested` deep-equals `current`) is not a change and needs
 * neither gate — otherwise every ordinary metadata save of a granted definition
 * would demand the grant feature. Callers that mint a NEW principal from an
 * existing grant (publish) MUST pass `current: []` so the copy is re-authorised.
 */
export async function authorizeWorkflowGrantChange(
  rbacService: RbacServiceLike,
  params: {
    userId: string
    scope: { tenantId: string | null; organizationId: string | null }
    requested: string[]
    current: string[]
  },
): Promise<WorkflowGrantAuthorizationFailure | null> {
  const requested = normalizeGrantedFeatures(params.requested)
  const current = normalizeGrantedFeatures(params.current)
  if (requested.length === current.length && requested.every((feature, index) => feature === current[index])) {
    return null
  }

  const mayGrant = await rbacService.userHasAllFeatures(params.userId, [WORKFLOW_GRANT_FEATURE], params.scope)
  if (!mayGrant) {
    return {
      status: 403,
      body: { error: 'Insufficient permissions', code: 'WORKFLOW_GRANT_FEATURE_REQUIRED' },
    }
  }

  if (!requested.length) return null

  const withinOwnGrants = await rbacService.userHasAllFeatures(params.userId, requested, params.scope)
  if (withinOwnGrants) return null

  const granted = rbacService.getGrantedFeatures
    ? await rbacService.getGrantedFeatures(params.userId, params.scope)
    : []
  return {
    status: 403,
    body: {
      error: 'Insufficient permissions',
      code: 'WORKFLOW_GRANT_EXCEEDS_GRANTOR_FEATURES',
      details: { missingFeatures: findUngrantableFeatures(requested, granted) },
    },
  }
}

export class WorkflowExecutionPrincipalMissingError extends Error {
  readonly code = 'EXECUTION_PRINCIPAL_MISSING'
  constructor(public readonly definitionId: string) {
    super(
      `[internal] workflow definition ${definitionId} declares granted features but its execution ` +
        `principal is not provisioned; refusing to fall back to the starting user`,
    )
    this.name = 'WorkflowExecutionPrincipalMissingError'
  }
}

/**
 * Provisions (idempotently) the definition's execution principal and re-scopes
 * its role ACL to exactly the declared grant — on every create, update and
 * publish, so an over-granted principal self-heals instead of lingering.
 *
 * A definition that never declared a grant provisions nothing (the opt-in stays
 * opt-in), but CLEARING a grant re-scopes the existing principal to no features
 * rather than leaving the old ACL behind for anything that still resolves it.
 */
export async function syncWorkflowDefinitionPrincipal(
  container: AwilixContainer,
  definition: WorkflowDefinitionGrantLike,
  options?: { previousFeatures?: string[] | null },
): Promise<void> {
  const features = normalizeGrantedFeatures(definition.grantedFeatures)
  const previous = normalizeGrantedFeatures(options?.previousFeatures)
  // Nothing declared and nothing to revoke ⇒ no principal, no writes at all.
  if (!features.length && !previous.length) return
  await provisionExecutionPrincipal(
    container,
    { tenantId: definition.tenantId, organizationId: definition.organizationId },
    {
      principalKey: workflowPrincipalKey(definition.id),
      displayName: `Workflow ${definition.workflowId ?? definition.id}`,
      features,
    },
  )
}

/**
 * The user id a run of `definition` acts as.
 *
 * Fails CLOSED: a definition that declares a grant whose principal cannot be
 * resolved throws rather than silently reverting to `fallbackUserId`, because
 * that fallback is precisely the escalation the grant exists to prevent.
 */
export async function resolveWorkflowDefinitionExecutionUserId(
  em: EntityManager,
  definition: WorkflowDefinitionGrantLike | null | undefined,
  fallbackUserId: string | null | undefined,
): Promise<string | null> {
  if (!definition || !definitionDeclaresGrant(definition)) return fallbackUserId ?? null
  const userId = await resolveExecutionPrincipalUserId(em, workflowPrincipalKey(definition.id), {
    tenantId: definition.tenantId,
    organizationId: definition.organizationId,
  })
  if (!userId) throw new WorkflowExecutionPrincipalMissingError(definition.id)
  return userId
}
