// =============================================================================
// Auth ACL Commands — Undo Policy
// =============================================================================
//
// Neither command in this file defines `undo` or `redo`, so the command bus
// never mints an undo token for them: `CommandBus.isUndoable()` requires a
// handler-provided `undo`. The explicit `isUndoable: false` below is executable
// documentation of that intent, not the mechanism — the guarantee comes from
// the absence of the handlers, and the unit tests pin both.
//
// The policy is deliberate even though an ACL grant is trivially reversible.
// The undo and redo endpoints are gated on `audit_logs.undo_self` /
// `audit_logs.undo_tenant` (and their redo counterparts), not on
// `auth.acl.manage`. `audit_logs.undo_self` is a default `employee` grant and
// `audit_logs.undo_tenant` reaches every `admin` through `audit_logs.*`, so an
// undoable ACL command would let a caller revert or replay someone else's
// permission change without ever holding the feature that authorizes editing
// permissions.
//
// Reversal stays available to the callers who are actually authorized for it:
// re-submitting the ACL form, gated on `auth.acl.manage` and guarded by
// `assertActorCanGrantAcl`. The audit log still captures the full before/after
// via `buildLog`, so any such correction is itself fully traceable.
// =============================================================================
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { Role, RoleAcl, User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

const logger = createLogger('auth').child({ component: 'acl-commands' })

type TaggableCache = { deleteByTags?: (tags: string[]) => Promise<void> | void }

/** Structural view of the fields both `RoleAcl` and `UserAcl` expose. */
type AclRecord = {
  isSuperAdmin: boolean
  featuresJson?: string[] | null
  organizationsJson?: string[] | null
}

/**
 * Audit snapshot of a single ACL row.
 *
 * `features` and `organizations` are grant *sets*, but `features_json` /
 * `organizations_json` preserve the client's insertion order. The command bus
 * derives `changes` from these snapshots with a deep equality check that is
 * order-sensitive for arrays, so an unsorted snapshot would report a spurious
 * `features` change every time an admin re-saves an unmodified form. Sorting
 * here makes the derived diff reflect real grant changes only.
 *
 * `organizations: null` (visible in every organization) is deliberately
 * distinct from `[]` (visible in none).
 */
type AclSnapshot = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

const EMPTY_ACL_SNAPSHOT: AclSnapshot = {
  isSuperAdmin: false,
  features: [],
  organizations: null,
}

/**
 * Identity of the role or user an entry is about.
 *
 * `action_logs` keeps only `resource_id`, so an entry degrades to a bare UUID
 * the moment the role or account is deleted — exactly when the trail matters
 * most. This rides in `context` rather than in the snapshots because the
 * command bus derives `changes` from the two snapshots with a deep comparison:
 * a target renamed between two ACL edits would otherwise be reported as a
 * permission change, and the no-op guard below would stop recognising an
 * unchanged ACL.
 */
type AclTarget =
  | { kind: 'user'; id: string; email: string | null; name: string | null }
  | { kind: 'role'; id: string; name: string | null }

/**
 * What the caller asked for when the route trimmed the request instead of
 * refusing it.
 *
 * `sanitizeTenantFeatures` drops restricted grants silently, so such a request
 * leaves `before` and `after` identical and is indistinguishable from a no-op —
 * which `buildLog` skips. Recording the original request both keeps the attempt
 * visible and exempts the entry from that guard.
 *
 * Features are the only axis carried, because they are the only one the route
 * can trim: a super-admin request is honoured or refused outright, and
 * organizations are never sanitized. Recording either would put a value next to
 * the snapshots that always matches them, inviting a reader to diff the two and
 * conclude a grant was refused.
 */
type SanitizedAclRequest = {
  features: string[]
}

/** How the change reads at a glance, without diffing two grant lists. */
type AclChangeEffect = 'granted' | 'changed' | 'revoked'

/**
 * Codepoint ordering rather than `localeCompare`: these snapshots are persisted
 * audit records, so the ordering must not shift with the runtime's default
 * locale. Feature and organization ids are opaque ASCII identifiers that are
 * never shown in this order to a user.
 *
 * The default comparator would coerce and compare the same way today, but
 * omitting one is banned repo-wide (`explicit-sort-comparators.test.ts`,
 * #3620): the ordering must be stated rather than inherited, so it cannot
 * silently change meaning if a call site ever drifts to non-strings. This is
 * the canonical-key form that audit prescribes.
 */
function compareIdentifiers(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function toSortedList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...values].filter((value): value is string => typeof value === 'string').sort(compareIdentifiers)
}

function captureAclSnapshot(acl: AclRecord | null | undefined): AclSnapshot {
  if (!acl) return { ...EMPTY_ACL_SNAPSHOT }
  return {
    isSuperAdmin: Boolean(acl.isSuperAdmin),
    features: toSortedList(acl.featuresJson),
    organizations: Array.isArray(acl.organizationsJson) ? toSortedList(acl.organizationsJson) : null,
  }
}

function holdsGrants(snapshot: AclSnapshot): boolean {
  return snapshot.isSuperAdmin || snapshot.features.length > 0
}

function resolveEffect(before: AclSnapshot, after: AclSnapshot): AclChangeEffect {
  if (!holdsGrants(before) && holdsGrants(after)) return 'granted'
  if (holdsGrants(before) && !holdsGrants(after)) return 'revoked'
  return 'changed'
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve('em') as EntityManager
}

/**
 * The log row's organization must belong to the same tenant as the row itself.
 *
 * A super admin may edit a role in a tenant other than their own, and
 * `ActionLogService.buildListQuery` filters with strict equality
 * (`organization_id = ?`, applied only when the reader supplies one). Stamping
 * the actor's organization onto a row scoped to a different tenant produces a
 * (tenant B, organization from tenant A) pair that no reader can ever match, so
 * the cross-tenant permission change — exactly the record worth keeping —
 * becomes invisible. `null` is the honest value there: it still reaches
 * tenant-scoped readers whose organization filter is unset.
 */
function resolveOrganizationId(ctx: CommandRuntimeContext, tenantId: string): string | null {
  if ((ctx.auth?.tenantId ?? null) !== tenantId) return null
  return ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
}

/**
 * A runtime with no cache registered (CLI, workers, tests) is a configuration,
 * not a failure, so resolution is guarded here. An adapter that *is* wired and
 * then throws is a failure, and it propagates to the single error-level guard
 * in `execute` — the same one that covers the `rbacService` half of this
 * invalidation. Reporting one half at `debug` and the other at `error` would
 * hide a nav cache still serving revoked grants.
 */
async function deleteCacheTags(ctx: CommandRuntimeContext, tags: string[]): Promise<void> {
  let cache: TaggableCache | undefined
  try {
    cache = ctx.container.resolve('cache') as TaggableCache | undefined
  } catch (err) {
    logger.debug('No cache registered for ACL tag invalidation', { err, tags })
    return
  }
  if (!cache?.deleteByTags) return
  await cache.deleteByTags(tags)
}

type AclCommandValues = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

type AclCommandInput = AclCommandValues & { tenantId: string }

export type RoleAclUpdateInput = AclCommandInput & {
  roleId: string
}

export type UserAclUpdateInput = AclCommandInput & {
  userId: string
  /** Mirrors the route's `!hasCustomAcl`: drop the override row instead of upserting it. */
  clear: boolean
  /** Set by the route only when it wrote less than the caller asked for. */
  requested?: SanitizedAclRequest | null
}

export type AclUpdateResult = {
  resourceId: string
  tenantId: string
  organizationId: string | null
}

export const AUTH_ROLE_ACL_UPDATE_COMMAND_ID = 'auth.role-acl.update'
export const AUTH_USER_ACL_UPDATE_COMMAND_ID = 'auth.user-acl.update'

type AclCommandConfig<TInput extends AclCommandInput> = {
  id: string
  resourceKind: string
  labelKey: string
  labelFallback: string
  resourceId: (input: TInput) => string
  loadAcl: (em: EntityManager, input: TInput) => Promise<AclRecord | null>
  persist: (params: { em: EntityManager; input: TInput; existing: AclRecord | null }) => Promise<void>
  invalidate: (params: { ctx: CommandRuntimeContext; input: TInput }) => Promise<void>
  /**
   * Post-state when the row is absent after the write. Only the user command's
   * clear path legitimately removes the row; anywhere else a missing row means
   * the re-read failed, which must be logged as "unknown" rather than guessed.
   */
  snapshotWhenAbsent: (input: TInput) => AclSnapshot | null
  /** Human-readable identity of the target; `null` when it cannot be resolved. */
  loadTarget: (em: EntityManager, input: TInput, ctx: CommandRuntimeContext) => Promise<AclTarget | null>
  /** Only the user route sanitizes, so only it can report a trimmed request. */
  sanitizedRequest?: (input: TInput) => SanitizedAclRequest | null
}

/**
 * Enrichment must never cost the entry.
 *
 * The bus persists the log after `execute` has already committed the permission
 * change, so a throw from the target lookup would leave the write recorded
 * nowhere — the same "committed but unaudited" hole the cache-invalidation
 * guard in `execute` closes. A missing label is a far smaller loss.
 */
async function loadTargetSafely<TInput extends AclCommandInput>(
  config: AclCommandConfig<TInput>,
  input: TInput,
  ctx: CommandRuntimeContext,
): Promise<AclTarget | null> {
  try {
    return await config.loadTarget(resolveEm(ctx).fork(), input, ctx)
  } catch (err) {
    logger.warn('Could not resolve the ACL target for the audit entry', {
      err,
      commandId: config.id,
      resourceId: config.resourceId(input),
      tenantId: input.tenantId,
    })
    return null
  }
}

function buildAuditContext(params: {
  target: AclTarget | null
  effect: AclChangeEffect | null
  sanitizedRequest: SanitizedAclRequest | null
}): Record<string, unknown> | null {
  const context: Record<string, unknown> = {}
  if (params.target) context.target = params.target
  if (params.effect) context.effect = params.effect
  if (params.sanitizedRequest) context.sanitizedRequest = params.sanitizedRequest
  return Object.keys(context).length ? context : null
}

/**
 * Both ACL commands differ only in entity, lookup key, cache invalidation and
 * labels — `prepare`, `captureAfter` and `buildLog` are otherwise identical.
 * Sharing them here keeps the two audit-entry shapes from drifting apart.
 */
function createAclUpdateCommand<TInput extends AclCommandInput>(
  config: AclCommandConfig<TInput>,
): CommandHandler<TInput, AclUpdateResult> {
  return {
    id: config.id,
    // See "Auth ACL Commands — Undo Policy" at top of file.
    isUndoable: false,
    async prepare(input, ctx) {
      const existing = await config.loadAcl(resolveEm(ctx).fork(), input)
      return { before: captureAclSnapshot(existing) }
    },
    async execute(input, ctx) {
      const em = resolveEm(ctx)
      const existing = await config.loadAcl(em, input)
      await config.persist({ em, input, existing })
      // Cache invalidation runs only after the write commits, never inside the
      // atomic flush — and must never propagate. The command bus persists the
      // action log *after* `execute` returns, so a throw here would commit the
      // permission change and then suppress its audit entry: precisely the
      // "committed but unaudited" hole these commands exist to close, and it
      // would open exactly when infrastructure is already degraded.
      // `RbacService.deleteCacheByTags` awaits the cache adapter without a
      // guard of its own, so an outage does reach us here.
      //
      // The resulting staleness (a revoked grant served from cache until its
      // TTL) is not introduced by swallowing — it happens either way once the
      // adapter is down. Logging at error level keeps it alarmable instead of
      // trading a recorded change for an HTTP 500 that misreports a write which
      // did commit.
      try {
        await config.invalidate({ ctx, input })
      } catch (err) {
        logger.error('ACL cache invalidation failed after a committed permission change', {
          err,
          commandId: config.id,
          resourceId: config.resourceId(input),
          tenantId: input.tenantId,
        })
      }
      return {
        resourceId: config.resourceId(input),
        tenantId: input.tenantId,
        organizationId: resolveOrganizationId(ctx, input.tenantId),
      }
    },
    captureAfter: async (input, _result, ctx) => {
      // Read the committed row back rather than echoing the request, so a grant
      // the route sanitized away can never be logged as if it had been applied.
      const persisted = await config.loadAcl(resolveEm(ctx).fork(), input)
      if (persisted) return captureAclSnapshot(persisted)
      return config.snapshotWhenAbsent(input)
    },
    buildLog: async ({ input, result, ctx, snapshots }) => {
      const before = (snapshots.before as AclSnapshot | undefined) ?? null
      const after = (snapshots.after as AclSnapshot | undefined) ?? null
      // An unknown post-state (`after: null`, the failed re-read) counts as a
      // change: it is the one case where the entry is the only evidence left.
      // Both snapshots leave `captureAclSnapshot` with their grant lists sorted,
      // so the shared order-sensitive comparison is a set comparison here.
      const changed = !before || !after || !snapshotsEqual(before, after)
      const sanitizedRequest = config.sanitizedRequest?.(input) ?? null
      // The admin user-edit page PUTs the ACL on every save, even when only the
      // name or the roles changed, and most accounts carry no per-user override
      // at all — so recording an unchanged ACL faithfully buries the real
      // permission changes under identical empty entries. A request the route
      // trimmed rather than refused also arrives with `before == after`; that
      // one is an escalation attempt and must survive this guard.
      if (!changed && !sanitizedRequest) return { skipLog: true }
      const { translate } = await resolveTranslations()
      const target = await loadTargetSafely(config, input, ctx)
      return {
        actionLabel: translate(config.labelKey, config.labelFallback),
        resourceKind: config.resourceKind,
        resourceId: result.resourceId,
        tenantId: result.tenantId,
        organizationId: result.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        context: buildAuditContext({
          target,
          // A sanitized-only entry is written *because* nothing changed, so
          // labelling it would have the trail assert a permission change that
          // never happened.
          effect: changed && before && after ? resolveEffect(before, after) : null,
          sanitizedRequest,
        }),
      }
    },
  }
}

const updateRoleAclCommand = createAclUpdateCommand<RoleAclUpdateInput>({
  id: AUTH_ROLE_ACL_UPDATE_COMMAND_ID,
  resourceKind: 'auth.role_acl',
  labelKey: 'auth.audit.roleAcl.update',
  labelFallback: 'Change role permissions',
  resourceId: (input) => input.roleId,
  loadAcl: (em, input) =>
    em.findOne(RoleAcl, { role: input.roleId as unknown as Role, tenantId: input.tenantId }),
  persist: async ({ em, input, existing }) => {
    const acl =
      (existing as RoleAcl | null) ??
      em.create(RoleAcl, {
        role: em.getReference(Role, input.roleId),
        tenantId: input.tenantId,
        createdAt: new Date(),
        isSuperAdmin: false,
      })
    await withAtomicFlush(
      em,
      [
        () => {
          acl.organizationsJson = input.organizations
          acl.isSuperAdmin = input.isSuperAdmin
          acl.featuresJson = input.features
          em.persist(acl)
        },
      ],
      { transaction: true, label: AUTH_ROLE_ACL_UPDATE_COMMAND_ID },
    )
  },
  invalidate: async ({ ctx, input }) => {
    // Every user in the tenant inherits this role's grants, so the whole tenant
    // scope is invalidated.
    const rbacService = ctx.container.resolve('rbacService') as RbacService
    await rbacService.invalidateTenantCache(input.tenantId)
    // Sidebar nav caches depend on RBAC; invalidate tenant scope nav caches
    await deleteCacheTags(ctx, [`rbac:tenant:${input.tenantId}`])
  },
  snapshotWhenAbsent: () => null,
  // Looked up by id alone: the entry already names this role through
  // `resource_id`, and a tenant predicate would only blank the label when a
  // super admin edits a role from outside the tenant scope they are writing in.
  loadTarget: async (em, input) => {
    const role = await em.findOne(Role, { id: input.roleId } as FilterQuery<Role>)
    if (!role) return null
    return { kind: 'role', id: input.roleId, name: role.name ?? null }
  },
})

const updateUserAclCommand = createAclUpdateCommand<UserAclUpdateInput>({
  id: AUTH_USER_ACL_UPDATE_COMMAND_ID,
  resourceKind: 'auth.user_acl',
  labelKey: 'auth.audit.userAcl.update',
  labelFallback: 'Change user permissions',
  resourceId: (input) => input.userId,
  loadAcl: (em, input) =>
    em.findOne(UserAcl, { user: input.userId as unknown as User, tenantId: input.tenantId }),
  persist: async ({ em, input, existing }) => {
    if (input.clear) {
      if (!existing) return
      const aclToRemove = existing as UserAcl
      await withAtomicFlush(
        em,
        [
          () => {
            em.remove(aclToRemove)
          },
        ],
        { transaction: true, label: AUTH_USER_ACL_UPDATE_COMMAND_ID },
      )
      return
    }
    const acl =
      (existing as UserAcl | null) ??
      em.create(UserAcl, {
        user: em.getReference(User, input.userId),
        tenantId: input.tenantId,
        createdAt: new Date(),
        isSuperAdmin: false,
      })
    await withAtomicFlush(
      em,
      [
        () => {
          acl.isSuperAdmin = input.isSuperAdmin
          acl.featuresJson = input.features
          acl.organizationsJson = input.organizations
          em.persist(acl)
        },
      ],
      { transaction: true, label: AUTH_USER_ACL_UPDATE_COMMAND_ID },
    )
  },
  invalidate: async ({ ctx, input }) => {
    const rbacService = ctx.container.resolve('rbacService') as RbacService
    await rbacService.invalidateUserCache(input.userId)
    await deleteCacheTags(ctx, [`rbac:user:${input.userId}`])
  },
  // Clearing removes the row, so an absent row is the real post-state here.
  snapshotWhenAbsent: (input) => (input.clear ? { ...EMPTY_ACL_SNAPSHOT } : null),
  // `userId` arrives in the request body and `auth:user` carries encrypted
  // personal data, so the lookup is tenant-scoped: an id belonging to another
  // tenant must not be decrypted under this scope and stamped into this
  // tenant's trail. A global account (`users.tenant_id` is nullable) still
  // resolves, mirroring how the role route widens its own lookup.
  loadTarget: async (em, input, ctx) => {
    const user = await findOneWithDecryption(
      em,
      User,
      { id: input.userId, $or: [{ tenantId: input.tenantId }, { tenantId: null }] } as FilterQuery<User>,
      {},
      { tenantId: input.tenantId, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!user) return null
    return { kind: 'user', id: input.userId, email: user.email ?? null, name: user.name ?? null }
  },
  sanitizedRequest: (input) => input.requested ?? null,
})

registerCommand(updateRoleAclCommand)
registerCommand(updateUserAclCommand)
