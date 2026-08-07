// =============================================================================
// Auth ACL Commands — Undo Policy
// =============================================================================
//
// Both commands in this file are deliberately registered with
// `isUndoable: false` and therefore opt out of the generic command-bus undo
// flow, even though an ACL grant is trivially reversible.
//
// The undo/redo endpoints are gated on `audit_logs.undo_self` /
// `audit_logs.undo_tenant` (and their redo counterparts), not on
// `auth.acl.manage`. `audit_logs.undo_self` is a default `employee` grant and
// `audit_logs.undo_tenant` reaches every `admin` through `audit_logs.*`, so an
// undoable ACL command would let a caller revert or replay someone else's
// permission change without ever holding the feature that authorizes editing
// permissions. Keeping these commands log-only preserves that separation of
// duties.
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
import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, RoleAcl, User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type TaggableCache = { deleteByTags?: (tags: string[]) => Promise<void> | void }

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

function captureAclSnapshot(acl: RoleAcl | UserAcl | null | undefined): AclSnapshot {
  if (!acl) return { ...EMPTY_ACL_SNAPSHOT }
  return {
    isSuperAdmin: Boolean(acl.isSuperAdmin),
    features: toSortedList(acl.featuresJson),
    organizations: Array.isArray(acl.organizationsJson) ? toSortedList(acl.organizationsJson) : null,
  }
}

function snapshotFromInput(input: AclCommandValues): AclSnapshot {
  return {
    isSuperAdmin: input.isSuperAdmin,
    features: toSortedList(input.features),
    organizations: Array.isArray(input.organizations) ? toSortedList(input.organizations) : null,
  }
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve('em') as EntityManager
}

function resolveOrganizationId(ctx: CommandRuntimeContext): string | null {
  return ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
}

async function deleteCacheTags(ctx: CommandRuntimeContext, tags: string[]): Promise<void> {
  try {
    const cache = ctx.container.resolve('cache') as TaggableCache | undefined
    if (cache?.deleteByTags) await cache.deleteByTags(tags)
  } catch {}
}

type AclCommandValues = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

export type RoleAclUpdateInput = AclCommandValues & {
  roleId: string
  tenantId: string
}

export type UserAclUpdateInput = AclCommandValues & {
  userId: string
  tenantId: string
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

const updateRoleAclCommand: CommandHandler<RoleAclUpdateInput, AclUpdateResult> = {
  id: AUTH_ROLE_ACL_UPDATE_COMMAND_ID,
  // See "Auth ACL Commands — Undo Policy" at top of file.
  isUndoable: false,
  async prepare(input, ctx) {
    const em = resolveEm(ctx).fork()
    const existing = await em.findOne(RoleAcl, {
      role: input.roleId as unknown as Role,
      tenantId: input.tenantId,
    })
    return { before: captureAclSnapshot(existing) }
  },
  async execute(input, ctx) {
    const em = resolveEm(ctx)
    const acl =
      (await em.findOne(RoleAcl, { role: input.roleId as unknown as Role, tenantId: input.tenantId })) ??
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

    // Every user in the tenant inherits this role's grants, so the whole tenant
    // scope is invalidated — after the write commits, never inside the flush.
    const rbacService = ctx.container.resolve('rbacService') as RbacService
    await rbacService.invalidateTenantCache(input.tenantId)
    // Sidebar nav caches depend on RBAC; invalidate tenant scope nav caches
    await deleteCacheTags(ctx, [`rbac:tenant:${input.tenantId}`])

    return {
      resourceId: input.roleId,
      tenantId: input.tenantId,
      organizationId: resolveOrganizationId(ctx),
    }
  },
  captureAfter: async (input, _result, ctx) => {
    const em = resolveEm(ctx).fork()
    const persisted = await em.findOne(RoleAcl, {
      role: input.roleId as unknown as Role,
      tenantId: input.tenantId,
    })
    // Fall back to the requested values only if the re-read misses; the
    // persisted row is authoritative so the log can never echo a request that
    // was sanitized on the way in.
    return persisted ? captureAclSnapshot(persisted) : snapshotFromInput(input)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('auth.audit.acl.role_update', 'Change role permissions'),
      resourceKind: 'auth.role_acl',
      resourceId: result.resourceId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotBefore: (snapshots.before as AclSnapshot | undefined) ?? null,
      snapshotAfter: (snapshots.after as AclSnapshot | undefined) ?? null,
    }
  },
}

const updateUserAclCommand: CommandHandler<UserAclUpdateInput, AclUpdateResult> = {
  id: AUTH_USER_ACL_UPDATE_COMMAND_ID,
  // See "Auth ACL Commands — Undo Policy" at top of file.
  isUndoable: false,
  async prepare(input, ctx) {
    const em = resolveEm(ctx).fork()
    const existing = await em.findOne(UserAcl, {
      user: input.userId as unknown as User,
      tenantId: input.tenantId,
    })
    return { before: captureAclSnapshot(existing) }
  },
  async execute(input, ctx) {
    const em = resolveEm(ctx)
    const existing = await em.findOne(UserAcl, {
      user: input.userId as unknown as User,
      tenantId: input.tenantId,
    })

    if (input.clear) {
      if (existing) {
        await withAtomicFlush(
          em,
          [
            () => {
              em.remove(existing)
            },
          ],
          { transaction: true, label: AUTH_USER_ACL_UPDATE_COMMAND_ID },
        )
      }
    } else {
      const acl =
        existing ??
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
    }

    const rbacService = ctx.container.resolve('rbacService') as RbacService
    await rbacService.invalidateUserCache(input.userId)
    await deleteCacheTags(ctx, [`rbac:user:${input.userId}`])

    return {
      resourceId: input.userId,
      tenantId: input.tenantId,
      organizationId: resolveOrganizationId(ctx),
    }
  },
  captureAfter: async (input, _result, ctx) => {
    // The clear path removes the row, so an absent row is the correct
    // post-state here rather than a failed lookup.
    const em = resolveEm(ctx).fork()
    const persisted = await em.findOne(UserAcl, {
      user: input.userId as unknown as User,
      tenantId: input.tenantId,
    })
    if (persisted) return captureAclSnapshot(persisted)
    return input.clear ? { ...EMPTY_ACL_SNAPSHOT } : snapshotFromInput(input)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('auth.audit.acl.user_update', 'Change user permissions'),
      resourceKind: 'auth.user_acl',
      resourceId: result.resourceId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotBefore: (snapshots.before as AclSnapshot | undefined) ?? null,
      snapshotAfter: (snapshots.after as AclSnapshot | undefined) ?? null,
    }
  },
}

registerCommand(updateRoleAclCommand)
registerCommand(updateUserAclCommand)
