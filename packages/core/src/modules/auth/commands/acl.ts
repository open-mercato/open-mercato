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
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
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
 * Codepoint ordering rather than `localeCompare`: these snapshots are persisted
 * audit records, so the ordering must not shift with the runtime's default
 * locale. Feature and organization ids are opaque ASCII identifiers that are
 * never shown in this order to a user.
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

async function deleteCacheTags(ctx: CommandRuntimeContext, tags: string[]): Promise<void> {
  try {
    const cache = ctx.container.resolve('cache') as TaggableCache | undefined
    if (cache?.deleteByTags) await cache.deleteByTags(tags)
  } catch (err) {
    // Best-effort: a stale nav cache must never fail a committed ACL write, but
    // a misconfigured adapter should not look identical to "no cache wired".
    logger.debug('ACL cache tag invalidation failed', { err, tags })
  }
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
    buildLog: async ({ result, snapshots }) => {
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(config.labelKey, config.labelFallback),
        resourceKind: config.resourceKind,
        resourceId: result.resourceId,
        tenantId: result.tenantId,
        organizationId: result.organizationId,
        snapshotBefore: (snapshots.before as AclSnapshot | undefined) ?? null,
        snapshotAfter: (snapshots.after as AclSnapshot | undefined) ?? null,
      }
    },
  }
}

const updateRoleAclCommand = createAclUpdateCommand<RoleAclUpdateInput>({
  id: AUTH_ROLE_ACL_UPDATE_COMMAND_ID,
  resourceKind: 'auth.role_acl',
  labelKey: 'auth.audit.acl.role_update',
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
})

const updateUserAclCommand = createAclUpdateCommand<UserAclUpdateInput>({
  id: AUTH_USER_ACL_UPDATE_COMMAND_ID,
  resourceKind: 'auth.user_acl',
  labelKey: 'auth.audit.acl.user_update',
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
})

registerCommand(updateRoleAclCommand)
registerCommand(updateUserAclCommand)
