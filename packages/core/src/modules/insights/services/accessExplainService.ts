import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getRemovedAclFeatureIds } from '@open-mercato/shared/security/featurePolicy'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { listSuperAdminUserIds } from '@open-mercato/core/modules/auth/lib/grantChecks'
import type {
  AccessExplanation,
  AccessRoleGrant,
  RbacService,
} from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { ActionLogFieldHistoryEntry } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import type {
  AccessExplainDetail,
  AccessExplainQuery,
  AccessExplainReason,
  AccessExplainResponse,
  AccessRecentChangeView,
  AccessRoleGrantView,
} from '../data/validators'
import { isOrganizationInScope } from '../lib/viewer'

const logger = createLogger('insights').child({ component: 'access-explain-service' })

export const ACCESS_DETAIL_FEATURE = 'insights.explain.access_detail'
export const ACCESS_OTHER_USER_FEATURES = [ACCESS_DETAIL_FEATURE, 'auth.users.list'] as const
export const ACCESS_RECENT_CHANGES_FEATURE = 'audit_logs.view_tenant'
export const ACCESS_RECENT_CHANGES_LIMIT = 10
export const ACCESS_RECENT_CHANGES_ROLE_LIMIT = 10
export const ACCESS_ALL_ORGANIZATIONS_TOKEN = '__all__'
export const SUPER_ADMIN_ROLE_NAME = 'superadmin'
export const RESTRICTED_ENTITY_FEATURE_PATTERN = /^entities\.records\.[a-z0-9_]+:[a-z0-9_]+\.(?:view|manage)$/

const API_KEY_PRINCIPAL_PREFIX = 'api_key:'
const USER_ACL_RESOURCE_KIND = 'auth.user_acl'
const ROLE_ACL_RESOURCE_KIND = 'auth.role_acl'
const USER_RESOURCE_KIND = 'auth.user'
const ROLES_CHANGE_KEY = 'roles'

export type AccessExplainCaller = {
  auth: NonNullable<AuthContext>
  tenantId: string
  organizationId: string | null
  selectedOrganizationId: string | null
  organizationIds: string[] | null
}

export type AccessExplainErrorBody = { error: string; details?: { features: string[] } }

export type AccessExplainOutcome =
  | { ok: true; body: AccessExplainResponse }
  | { ok: false; status: 400 | 403 | 404; body: AccessExplainErrorBody }

export type AccessExplainServiceDeps = {
  em: EntityManager
  rbacService: RbacService
  actionLogService?: Pick<ActionLogService, 'findFieldHistory'> | null
  listFeatureCatalog?: () => ReadonlySet<string>
}

type ExplainSubject = {
  principalId: string
  kind: 'user' | 'api_key'
  id: string
  isSelf: boolean
  organizationId: string | null
}

type SubjectResolution = { ok: true; subject: ExplainSubject } | { ok: false; outcome: AccessExplainOutcome }

type RecentChangeSource = {
  kind: AccessRecentChangeView['kind']
  resourceKind: string
  resourceId: string
}

export const ACCESS_SUMMARY_KEYS = {
  granted: 'insights.explain.access.summary.granted',
  not_determinable: 'insights.explain.access.summary.notDeterminable',
  missing_feature: 'insights.explain.access.summary.missingFeature',
  organization_out_of_scope: 'insights.explain.access.summary.organizationOutOfScope',
  user_acl_override: 'insights.explain.access.summary.userAclOverride',
  module_disabled: 'insights.explain.access.summary.moduleDisabled',
  feature_removed: 'insights.explain.access.summary.featureRemoved',
} as const satisfies Record<AccessExplainReason | 'granted', string>

const SUMMARY_REASON_PRIORITY: readonly AccessExplainReason[] = [
  'feature_removed',
  'module_disabled',
  'user_acl_override',
  'organization_out_of_scope',
  'missing_feature',
  'not_determinable',
]

/** Picks the summary template for the decision's main reason; parameters are feature ids and counts only. */
export function buildAccessSummary(
  required: ReadonlyArray<{ feature: string; granted: boolean }>,
  reasons: readonly AccessExplainReason[],
): AccessExplainResponse['summary'] {
  const primary = SUMMARY_REASON_PRIORITY.find((reason) => reasons.includes(reason))
  if (!primary) return { key: ACCESS_SUMMARY_KEYS.granted, params: { count: required.length } }
  if (primary === 'not_determinable') return { key: ACCESS_SUMMARY_KEYS.not_determinable, params: {} }
  const missing = required.filter((entry) => !entry.granted).map((entry) => entry.feature)
  return { key: ACCESS_SUMMARY_KEYS[primary], params: { features: missing.join(', '), count: missing.length } }
}

const NOT_FOUND: AccessExplainOutcome = { ok: false, status: 404, body: { error: 'not_found' } }
const FORBIDDEN: AccessExplainOutcome = { ok: false, status: 403, body: { error: 'forbidden' } }

/**
 * The staff ACL catalog: every feature declared by an enabled module, plus features
 * removed by an ACL override (so they can still be explained as `feature_removed`).
 * Per-entity record features of restricted custom entities are accepted by their
 * reserved shape (`entities.records.<entityId>.view|manage`) instead of a tenant lookup,
 * so the check never reveals which custom entities are restricted.
 */
export function listAclCatalogFeatureIds(): Set<string> {
  const ids = new Set<string>()
  for (const registeredModule of tryGetModules() ?? []) {
    for (const feature of Array.isArray(registeredModule.features) ? registeredModule.features : []) {
      if (feature && typeof feature.id === 'string' && feature.id.length > 0) ids.add(feature.id)
    }
  }
  for (const featureId of getRemovedAclFeatureIds()) ids.add(featureId)
  return ids
}

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function mentionsRoleChange(entry: ActionLogFieldHistoryEntry): boolean {
  if (entry.actionType === 'create') return true
  if (Array.isArray(entry.changedFields) && entry.changedFields.includes(ROLES_CHANGE_KEY)) return true
  return Boolean(entry.changes && Object.prototype.hasOwnProperty.call(entry.changes, ROLES_CHANGE_KEY))
}

function compareDescending(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? 1 : -1
}

function compareRecentChanges(left: AccessRecentChangeView, right: AccessRecentChangeView): number {
  return compareDescending(left.at, right.at) || compareDescending(left.logId, right.logId)
}

type OrganizationRedactor = {
  list: (values: string[] | null) => string[] | null
  role: (grant: AccessRoleGrant) => AccessRoleGrantView
  isRedacted: () => boolean
}

/**
 * Keeps only organization ids inside the caller's scope (a tenant-wide caller sees all)
 * and remembers whether anything was omitted.
 */
function createOrganizationRedactor(organizationIds: string[] | null): OrganizationRedactor {
  let redacted = false
  const list = (values: string[] | null): string[] | null => {
    if (values === null || organizationIds === null) return values
    const visible = values.filter((value) => value === ACCESS_ALL_ORGANIZATIONS_TOKEN || organizationIds.includes(value))
    if (visible.length !== values.length) redacted = true
    return visible
  }
  return {
    list,
    role: (grant) => ({
      id: grant.roleId,
      name: grant.roleName,
      isSuperAdmin: grant.isSuperAdmin,
      organizations: list(grant.organizations),
      appliesToOrganization: grant.appliesToOrganization,
      grantedFeatures: [...grant.grantedFeatures],
    }),
    isRedacted: () => redacted,
  }
}

/**
 * Explains RBAC decisions for `GET /api/insights/explain/access`. The decision and its
 * reasons come from `RbacService.explainAccess` (same projection and policy as the
 * guards). Detail is returned only to callers holding `insights.explain.access_detail`;
 * explaining another user additionally requires `auth.users.list`, and that user must be
 * inside the caller's tenant and organization scope (otherwise 404). Like the users and
 * roles lists, super-administrator users and roles stay hidden from callers who are not
 * super administrators. A `path` marks a denial outside RBAC (`not_determinable`) only
 * for the caller's own access, the only denial the caller actually experienced.
 */
export class AccessExplainService {
  constructor(private readonly deps: AccessExplainServiceDeps) {}

  async explain(caller: AccessExplainCaller, query: AccessExplainQuery): Promise<AccessExplainOutcome> {
    const features = uniqueValues(query.features)
    const unknown = this.findUnknownFeatures(features)
    if (unknown.length > 0) return { ok: false, status: 400, body: { error: 'unknown_feature', details: { features: unknown } } }

    const resolution = await this.resolveSubject(caller, query.userId ?? null)
    if (!resolution.ok) return resolution.outcome
    const subject = resolution.subject
    const canSeeDetail = subject.isSelf
      ? await this.callerHas(caller, [ACCESS_DETAIL_FEATURE])
      : true

    const explanation = await this.deps.rbacService.explainAccess(
      subject.principalId,
      features,
      { tenantId: caller.tenantId, organizationId: subject.organizationId },
      { detail: canSeeDetail },
    )
    const reasons = this.resolveReasons(explanation, subject.isSelf && Boolean(query.path))
    const required = explanation.required.map(({ feature, granted }) => ({ feature, granted }))
    const detail = canSeeDetail ? await this.presentDetail(caller, subject, explanation) : null
    return {
      ok: true,
      body: {
        decision: explanation.decision,
        required,
        reasons,
        summary: buildAccessSummary(required, reasons),
        detail,
        confidence: reasons.includes('not_determinable') ? 'unknown' : explanation.confidence,
      },
    }
  }

  private resolveReasons(explanation: AccessExplanation, deniedAtPath: boolean): AccessExplainReason[] {
    if (explanation.decision === 'granted') return deniedAtPath ? ['not_determinable'] : []
    return explanation.reasons.length > 0 ? [...explanation.reasons] : ['not_determinable']
  }

  private callerHas(caller: AccessExplainCaller, features: readonly string[]): Promise<boolean> {
    return this.deps.rbacService.userHasAllFeatures(caller.auth.sub, [...features], {
      tenantId: caller.tenantId,
      organizationId: caller.organizationId,
    })
  }

  private findUnknownFeatures(features: readonly string[]): string[] {
    const catalog = this.deps.listFeatureCatalog ? this.deps.listFeatureCatalog() : listAclCatalogFeatureIds()
    return features.filter((feature) => !catalog.has(feature) && !RESTRICTED_ENTITY_FEATURE_PATTERN.test(feature))
  }

  private async resolveSubject(caller: AccessExplainCaller, userId: string | null): Promise<SubjectResolution> {
    const callerSub = caller.auth.sub
    if (!userId || userId.toLowerCase() === callerSub.toLowerCase()) {
      const isApiKey = callerSub.startsWith(API_KEY_PRINCIPAL_PREFIX)
      return {
        ok: true,
        subject: {
          principalId: callerSub,
          kind: isApiKey ? 'api_key' : 'user',
          id: isApiKey ? callerSub.slice(API_KEY_PRINCIPAL_PREFIX.length) : callerSub,
          isSelf: true,
          organizationId: caller.organizationId,
        },
      }
    }
    if (!(await this.callerHas(caller, ACCESS_OTHER_USER_FEATURES))) return { ok: false, outcome: FORBIDDEN }
    if (Array.isArray(caller.organizationIds) && caller.organizationIds.length === 0) return { ok: false, outcome: NOT_FOUND }
    const user = await findOneWithDecryption(
      this.deps.em,
      User,
      { id: userId, tenantId: caller.tenantId, deletedAt: null },
      undefined,
      { tenantId: caller.tenantId, organizationId: null },
    )
    if (!user) return { ok: false, outcome: NOT_FOUND }
    const userOrganizationId = user.organizationId ?? null
    if (!isOrganizationInScope(userOrganizationId, caller.organizationIds)) return { ok: false, outcome: NOT_FOUND }
    const targetId = String(user.id)
    if (await this.isHiddenSuperAdmin(caller, targetId)) return { ok: false, outcome: NOT_FOUND }
    return {
      ok: true,
      subject: {
        principalId: targetId,
        kind: 'user',
        id: targetId,
        isSelf: false,
        organizationId: caller.selectedOrganizationId ?? userOrganizationId,
      },
    }
  }

  private async isCallerSuperAdmin(caller: AccessExplainCaller): Promise<boolean> {
    if (caller.auth.isSuperAdmin === true) return true
    const callerAcl = await this.deps.rbacService.loadAcl(caller.auth.sub, {
      tenantId: caller.tenantId,
      organizationId: caller.organizationId,
    })
    return callerAcl.isSuperAdmin === true
  }

  private async isHiddenSuperAdmin(caller: AccessExplainCaller, userId: string): Promise<boolean> {
    if (await this.isCallerSuperAdmin(caller)) return false
    const superAdminIds = await listSuperAdminUserIds(this.deps.em, caller.tenantId)
    return superAdminIds.has(userId)
  }

  private async presentDetail(
    caller: AccessExplainCaller,
    subject: ExplainSubject,
    explanation: AccessExplanation,
  ): Promise<AccessExplainDetail | null> {
    const detail = explanation.detail
    if (!detail) return null
    const redactor = createOrganizationRedactor(caller.organizationIds)
    const callerIsSuperAdmin = await this.isCallerSuperAdmin(caller)
    const visibleGrantingRoles = callerIsSuperAdmin
      ? detail.rolesThatWouldGrant
      : detail.rolesThatWouldGrant.filter((grant) => !grant.isSuperAdmin && grant.roleName !== SUPER_ADMIN_ROLE_NAME)
    const presented: AccessExplainDetail = {
      subject: { kind: subject.kind, id: subject.id, isSelf: subject.isSelf },
      source: detail.source,
      organizationId: detail.organizationId,
      organizationAllowed: detail.organizationAllowed,
      aclOrganizations: redactor.list(detail.aclOrganizations),
      features: detail.features.map((entry) => ({ feature: entry.feature, granted: entry.granted, reason: entry.reason })),
      userAcl: detail.userAcl
        ? {
          isSuperAdmin: detail.userAcl.isSuperAdmin,
          organizations: redactor.list(detail.userAcl.organizations),
          grantedFeatures: [...detail.userAcl.grantedFeatures],
        }
        : null,
      roles: detail.roles.map((grant) => redactor.role(grant)),
      rolesThatWouldGrant: visibleGrantingRoles.map((grant) => redactor.role(grant)),
      grantedOrganizationIds: redactor.list(detail.grantedOrganizationIds),
      organizationsRedacted: false,
      recentChanges: await this.loadRecentChanges(caller, subject, detail.roles),
      consistentWithFreshRead: explanation.consistentWithFreshRead,
    }
    presented.organizationsRedacted = redactor.isRedacted()
    return presented
  }

  /**
   * Latest audit entries that change the subject's grants: its per-user ACL, its role
   * assignments, and the ACLs of its roles. Requires `audit_logs.view_tenant` and reads
   * only within the caller's organization scope; a failed read is reported and yields
   * null rather than failing the explanation.
   */
  private async loadRecentChanges(
    caller: AccessExplainCaller,
    subject: ExplainSubject,
    roles: readonly AccessRoleGrant[],
  ): Promise<AccessRecentChangeView[] | null> {
    const reader = this.deps.actionLogService
    if (!reader) return null
    if (!(await this.callerHas(caller, [ACCESS_RECENT_CHANGES_FEATURE]))) return null
    const sources: RecentChangeSource[] = []
    if (subject.kind === 'user') {
      sources.push({ kind: 'user_acl', resourceKind: USER_ACL_RESOURCE_KIND, resourceId: subject.id })
      sources.push({ kind: 'user_roles', resourceKind: USER_RESOURCE_KIND, resourceId: subject.id })
    }
    const roleIds = uniqueValues(roles.map((role) => role.roleId)).slice(0, ACCESS_RECENT_CHANGES_ROLE_LIMIT)
    for (const roleId of roleIds) sources.push({ kind: 'role_acl', resourceKind: ROLE_ACL_RESOURCE_KIND, resourceId: roleId })
    try {
      const changes: AccessRecentChangeView[] = []
      for (const source of sources) {
        const page = await reader.findFieldHistory({
          tenantId: caller.tenantId,
          organizationIds: caller.organizationIds,
          resourceKinds: [source.resourceKind],
          resourceId: source.resourceId,
          limit: ACCESS_RECENT_CHANGES_LIMIT,
        })
        for (const entry of page.entries) {
          if (entry.executionState === 'failed') continue
          if (source.kind === 'user_roles' && !mentionsRoleChange(entry)) continue
          changes.push({
            logId: entry.logId,
            at: entry.at,
            kind: source.kind,
            resourceId: entry.resourceId,
            commandId: entry.commandId,
            actionLabel: entry.actionLabel ?? null,
          })
        }
      }
      return changes.sort(compareRecentChanges).slice(0, ACCESS_RECENT_CHANGES_LIMIT)
    } catch (error) {
      logger.warn('Failed to load recent ACL changes for access explanation', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.access_recent_changes_failed' })
      return null
    }
  }
}
