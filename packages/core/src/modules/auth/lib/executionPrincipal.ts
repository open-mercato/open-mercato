import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from './emailHash'
import { Role, RoleAcl, User, UserRole, type UserKind } from '../data/entities'

/**
 * A non-interactive execution principal: a login-less `User` plus a scoped
 * `Role` whose ACL carries EXACTLY the features that principal may use.
 *
 * This lives in `auth` because `User` / `Role` / `RoleAcl` / `UserRole` are this
 * module's entities. Any module that needs a machine identity to write under —
 * an agentic task, a workflow definition declaring a grant, a future scheduled
 * job — provisions one here rather than reimplementing the four find-or-create
 * steps and the ACL replacement.
 *
 * The `enterprise` agent_orchestrator module owns an older copy of this logic
 * (`lib/identity/agentPrincipalService.ts`), which core MUST NOT import (an
 * optional peer). The naming knobs below exist so that copy can be migrated onto
 * this helper WITHOUT changing any provisioned row's identity: calling with
 * `{ namePrefix: 'agent', kind: 'agent', mergeFeatures: true }` reproduces its
 * email and role name byte-for-byte.
 */
export type ExecutionPrincipalScope = { tenantId: string; organizationId: string }

export type ResolvedExecutionPrincipal = {
  userId: string
  roleId: string
}

export type ProvisionExecutionPrincipalInput = {
  /**
   * Namespaced, stable identity key — e.g. `workflow:<definitionId>`. It is the
   * idempotency key: the deterministic email and role name are both derived from
   * it, so re-provisioning resolves the same rows instead of creating new ones.
   */
  principalKey: string
  displayName?: string
  /** The principal's complete feature set. Replaces the role ACL unless `mergeFeatures`. */
  features: string[]
  /** Defaults to `service` — a machine principal that is not an AI agent. */
  kind?: UserKind
  /** Local-part / role-name prefix. Defaults to `principal`. */
  namePrefix?: string
  /**
   * Merge into the existing ACL instead of replacing it. Default `false`:
   * merging cannot NARROW a previously over-granted principal, which is the
   * whole point of re-scoping on every save.
   */
  mergeFeatures?: boolean
}

/**
 * Non-routable internal domain. An execution principal never receives mail and
 * never logs in interactively, so this address is an identity key, not a mailbox.
 */
const EXECUTION_PRINCIPAL_EMAIL_DOMAIN = 'agent.internal'
const DEFAULT_NAME_PREFIX = 'principal'

function slugifyPrincipalKey(principalKey: string): string {
  return principalKey.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

export function executionPrincipalEmail(
  principalKey: string,
  organizationId: string,
  namePrefix: string = DEFAULT_NAME_PREFIX,
): string {
  return `${namePrefix}+${slugifyPrincipalKey(principalKey)}+${organizationId}@${EXECUTION_PRINCIPAL_EMAIL_DOMAIN}`
}

export function executionPrincipalRoleName(
  principalKey: string,
  namePrefix: string = DEFAULT_NAME_PREFIX,
): string {
  return `${namePrefix}:${principalKey}`
}

export function normalizeFeatureList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed) seen.add(trimmed)
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

/**
 * Provisions — idempotently — the execution principal for `principalKey` and
 * pins its role ACL to exactly `features`.
 *
 * Non-interactive by construction: `passwordHash = null` + `isConfirmed = false`
 * leaves the password/SSO flow nothing to authenticate against. `isSuperAdmin`
 * is always false and the ACL's organization visibility is pinned to the
 * provisioning organization, so the principal can never out-scope its owner.
 */
export async function provisionExecutionPrincipal(
  container: AwilixContainer,
  scope: ExecutionPrincipalScope,
  input: ProvisionExecutionPrincipalInput,
): Promise<ResolvedExecutionPrincipal> {
  const { tenantId, organizationId } = scope
  const principalKey = input.principalKey.trim()
  if (!principalKey) throw new Error('[internal] execution principal requires a principalKey')
  if (!tenantId || !organizationId) {
    throw new Error('[internal] execution principal requires a tenant and organization scope')
  }

  const namePrefix = input.namePrefix ?? DEFAULT_NAME_PREFIX
  const kind: UserKind = input.kind ?? 'service'
  const features = normalizeFeatureList(input.features)
  const roleName = executionPrincipalRoleName(principalKey, namePrefix)
  const principalEmail = executionPrincipalEmail(principalKey, organizationId, namePrefix)

  const em = (container.resolve('em') as EntityManager).fork()

  return em.transactional(async (trx) => {
    let role = await findOneWithDecryption(
      trx,
      Role,
      { name: roleName, tenantId },
      {},
      { tenantId, organizationId: null },
    )
    if (!role) {
      role = trx.create(Role, { name: roleName, tenantId, minActiveHolders: 0, createdAt: new Date() })
      trx.persist(role)
      await trx.flush()
    }

    const existingAcl = await findOneWithDecryption(
      trx,
      RoleAcl,
      { role, tenantId },
      {},
      { tenantId, organizationId: null },
    )
    if (!existingAcl) {
      trx.persist(
        trx.create(RoleAcl, {
          role,
          tenantId,
          featuresJson: features,
          isSuperAdmin: false,
          organizationsJson: [organizationId],
          createdAt: new Date(),
        }),
      )
      await trx.flush()
    } else {
      const current = normalizeFeatureList(existingAcl.featuresJson)
      const next = input.mergeFeatures ? normalizeFeatureList([...current, ...features]) : features
      if (
        existingAcl.isSuperAdmin ||
        current.length !== next.length ||
        current.some((feature, index) => feature !== next[index])
      ) {
        existingAcl.featuresJson = next
        existingAcl.isSuperAdmin = false
        existingAcl.organizationsJson = [organizationId]
        trx.persist(existingAcl)
        await trx.flush()
      }
    }

    const emailHash = computeEmailHash(principalEmail)
    let user = await findOneWithDecryption(
      trx,
      User,
      { emailHash, tenantId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (!user) {
      user = trx.create(User, {
        email: principalEmail,
        emailHash,
        passwordHash: null,
        isConfirmed: false,
        kind,
        name: input.displayName ?? principalKey,
        tenantId,
        organizationId,
        createdAt: new Date(),
      })
      trx.persist(user)
      await trx.flush()
    } else if (user.kind === 'human') {
      // Defensive: a row resolved by the deterministic principal email must never
      // be a human account. Never silently repurpose one.
      throw new Error('[internal] resolved a human User for an execution principal')
    }

    const existingLink = await findOneWithDecryption(
      trx,
      UserRole,
      { user, role },
      {},
      { tenantId, organizationId: null },
    )
    if (!existingLink) {
      trx.persist(trx.create(UserRole, { user, role, createdAt: new Date() }))
      await trx.flush()
    }

    return { userId: user.id, roleId: role.id }
  })
}

/**
 * Resolves the `User` id of an already-provisioned execution principal without
 * writing anything. Returns null when it has not been provisioned (or was
 * soft-deleted) — callers MUST fail closed rather than fall back to a broader
 * identity.
 */
export async function resolveExecutionPrincipalUserId(
  em: EntityManager,
  principalKey: string,
  scope: ExecutionPrincipalScope,
  namePrefix: string = DEFAULT_NAME_PREFIX,
): Promise<string | null> {
  const { tenantId, organizationId } = scope
  if (!principalKey || !tenantId || !organizationId) return null
  const emailHash = computeEmailHash(executionPrincipalEmail(principalKey, organizationId, namePrefix))
  const user = await findOneWithDecryption(
    em,
    User,
    { emailHash, tenantId, deletedAt: null },
    {},
    { tenantId, organizationId },
  )
  return user?.id ?? null
}
