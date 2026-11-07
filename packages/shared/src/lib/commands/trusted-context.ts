import type { CommandLogMetadata, CommandRuntimeContext } from './types'

/**
 * One trusted (request-less) command/audit context builder, per
 * `ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md` §X10. Every caller that builds a
 * `CommandRuntimeContext` NOT derived from an HTTP request goes through this helper instead of
 * hand-rolling the shape — the three Release 5 call sites are D-R5-14 (re-authoring a superseded
 * proposal as its original author), D-R5-19 (seeding a pay-link cart with a trusted in-process
 * context) and D-R5-22/X15 (`storeContextService.resolveForBuyer` and checkout recovery
 * re-locking a cart from its stored identity).
 *
 * The production shapes below already exist, unlabeled, at several call sites:
 * - `actorType: 'system'` mirrors `packages/core/src/modules/warranty_claims/workers/
 *   sla-escalation-sweep.ts` and `packages/core/src/modules/push_notifications/lib/
 *   push-delivery.ts` (`auth: null`, `systemActor: true`).
 * - `actorType: 'user'` mirrors `packages/enterprise/src/modules/agent_orchestrator/workers/
 *   eval-suite-runner.ts` (`auth: { sub, tenantId, orgId }`, no `systemActor` flag — the command
 *   bus already derives `actorUserId` from `auth.sub` for that case).
 *
 * Both branches are still "system-initiated" for audit purposes — the call is not driven by that
 * actor's live request — so `auditMetadata.context` always carries the same marker, reusing the
 * key (`systemActor`) the command bus itself already writes under
 * `packages/shared/src/lib/commands/command-bus.ts`'s own `systemActorContext` fallback (which
 * only fires when no `actorUserId` is present). This helper is the one place a caller-supplied
 * `actorUserId` gets the same marker, instead of a second, parallel audit convention.
 */
export type TrustedCommandContextInput = {
  tenantId: string
  organizationId: string
  /**
   * `'system'` — no end-user actor; the call is purely automated (a sweeper, a recovery job).
   * `'user'` — attributed to a real, known actor (`actorId`) even though the call is not driven
   * by that user's live request (e.g. re-authoring a proposal as its original author).
   */
  actorType: 'system' | 'user'
  /** Required when `actorType` is `'user'`; the `auth.User` (or customer) id attributed. */
  actorId?: string
  /** Short, machine-readable reason recorded on every audit entry built from this context. */
  reason: string
}

/** Spread into a caller's own `CommandRuntimeContext` alongside its `container`. */
export type TrustedCommandContext = Pick<
  CommandRuntimeContext,
  'auth' | 'organizationScope' | 'selectedOrganizationId' | 'organizationIds' | 'systemActor' | 'request'
>

/** Spread into (or passed as) a command's `CommandLogMetadata`. */
export type TrustedCommandAuditMetadata = Pick<
  CommandLogMetadata,
  'tenantId' | 'organizationId' | 'actorUserId' | 'context'
>

export type TrustedCommandContextResult = {
  ctx: TrustedCommandContext
  auditMetadata: TrustedCommandAuditMetadata
}

/**
 * The single marker every trusted (request-less) context's audit trail carries, under the same
 * `context.systemActor` key the command bus's own fallback already writes
 * (`{ systemActor: 'system:command' }`) — a distinct value so a reader can tell the two sources
 * apart without a second lookup path.
 */
const TRUSTED_CONTEXT_MARKER = 'system:trusted-context'

export function buildTrustedCommandContext(input: TrustedCommandContextInput): TrustedCommandContextResult {
  const { tenantId, organizationId, actorType, actorId, reason } = input
  if (!tenantId) throw new Error('[internal] buildTrustedCommandContext requires tenantId')
  if (!organizationId) throw new Error('[internal] buildTrustedCommandContext requires organizationId')
  if (!reason) throw new Error('[internal] buildTrustedCommandContext requires reason')
  if (actorType === 'user' && !actorId) {
    throw new Error('[internal] buildTrustedCommandContext requires actorId when actorType is "user"')
  }

  const ctx: TrustedCommandContext =
    actorType === 'user'
      ? {
          auth: { sub: actorId as string, tenantId, orgId: organizationId } as CommandRuntimeContext['auth'],
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: [organizationId],
          request: undefined,
        }
      : {
          auth: null,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: [organizationId],
          systemActor: true,
          request: undefined,
        }

  const auditMetadata: TrustedCommandAuditMetadata = {
    tenantId,
    organizationId,
    actorUserId: actorType === 'user' ? (actorId as string) : null,
    context: { systemActor: TRUSTED_CONTEXT_MARKER, reason },
  }

  return { ctx, auditMetadata }
}
