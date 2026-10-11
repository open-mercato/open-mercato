import { createHash } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  SIMULATION_PERMISSION_PREVIEW_ACCESS_LOG_KIND,
  defineSimulationKind,
  type SimulationArtifactVersion,
  type SimulationGroup,
  type SimulationKindResult,
  type SimulationLiveRecord,
  type SimulationLiveRecordsContext,
  type SimulationLiveRecordsPage,
  type SimulationScope,
  type SimulationServiceResolver,
  type SimulationValidationContext,
  type SimulationValidationResult,
} from '@open-mercato/shared/modules/insights/simulate'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Role, RoleAcl, User } from '../../data/entities'
import { roleAclPreviewProposalSchema, type RoleAclPreviewProposal } from '../../data/validators'
import type { RbacService, RoleAclChangePreview } from '../../services/rbacService'
import { assertActorCanGrantAcl, assertActorCanModifySuperAdminRoleTarget } from '../grantChecks'
import {
  EMPTY_ROLE_ACL_SNAPSHOT,
  normalizeRoleAclSnapshot,
  roleAclFingerprintSource,
  sameRoleAcl,
  type RoleAclSnapshot,
} from '../roleAclFingerprint'
import { findUnknownAclFeatures, loadAclFeatureCatalog } from './aclCatalog'
import { loadGatedSurface, type GatedSurface, type GatedSurfaceKind } from './gatedSurface'

export const ROLE_ACL_PREVIEW_KIND = 'auth.role_acl_preview'
export const ROLE_ACL_PREVIEW_ARTIFACT_KIND = 'auth.role_acl'
export const ROLE_ACL_PREVIEW_VERSION = 1
export const ROLE_ACL_PREVIEW_TTL_HOURS = 24
export const ROLE_ACL_PREVIEW_FEATURES = ['auth.acl.manage', 'auth.users.list'] as const
export const ROLE_ACL_PREVIEW_RECORD_FEATURES = ['auth.users.list'] as const
export const ROLE_ACL_PREVIEW_CELLS = ['gains', 'loses', 'gains_and_loses', 'unchanged'] as const
export const ROLE_ACL_MANAGE_FEATURE = 'auth.acl.manage'
export const API_KEYS_VIEW_FEATURE = 'api_keys.view'

export type RoleAclPreviewCell = (typeof ROLE_ACL_PREVIEW_CELLS)[number]

export type RoleAclPrincipalType = 'user' | 'api_key'

export const ROLE_ACL_PREVIEW_GROUP_SUFFIX: Record<RoleAclPrincipalType, string> = {
  user: 'users',
  api_key: 'api_keys',
}

export const ROLE_ACL_PREVIEW_I18N = {
  label: 'auth.simulation.kind.roleAclPreview',
  groups: {
    user: 'auth.simulation.groups.users',
    api_key: 'auth.simulation.groups.apiKeys',
  },
  warnings: {
    selfLockoutAclManage: 'auth.simulation.warnings.selfLockoutAclManage',
    selfLockoutOrganization: 'auth.simulation.warnings.selfLockoutOrganization',
  },
  caveats: {
    currentState: 'auth.simulation.caveats.currentState',
    superAdminsExcluded: 'auth.simulation.caveats.superAdminsExcluded',
    ephemeralKeysExcluded: 'auth.simulation.caveats.ephemeralKeysExcluded',
    organizationScope: 'auth.simulation.caveats.organizationScope',
    notCounted: 'auth.simulation.caveats.notCounted',
    pagesUnavailable: 'auth.simulation.caveats.pagesUnavailable',
    apiRoutesUnavailable: 'auth.simulation.caveats.apiRoutesUnavailable',
    truncated: 'auth.simulation.caveats.truncated',
    roleUnavailable: 'auth.simulation.caveats.roleUnavailable',
    apiKeysHidden: 'auth.simulation.caveats.apiKeysHidden',
  },
  notes: {
    proposalInEffect: 'auth.simulation.records.proposalInEffect',
  },
} as const

const SURFACE_COUNT_KEYS: Record<GatedSurfaceKind, { gained: string; lost: string }> = {
  page: { gained: 'pages_gained', lost: 'pages_lost' },
  menu_item: { gained: 'menu_items_gained', lost: 'menu_items_lost' },
  api_route: { gained: 'api_routes_gained', lost: 'api_routes_lost' },
}

/** The ACL a proposal would save, normalized like `PUT /api/auth/roles/acl`. */
export function roleAclProposalSnapshot(proposal: RoleAclPreviewProposal): RoleAclSnapshot {
  return normalizeRoleAclSnapshot({
    isSuperAdmin: proposal.isSuperAdmin,
    features: proposal.features,
    organizations: proposal.organizations,
  })
}

/** S15 fingerprint of an ACL's access-deciding content (sha256 of `roleAclFingerprintSource`). */
export function fingerprintRoleAcl(snapshot: RoleAclSnapshot): string {
  return createHash('sha256').update(roleAclFingerprintSource(snapshot)).digest('hex')
}

export function roleAclPreviewGroupKey(organizationId: string, type: RoleAclPrincipalType): string {
  return `${organizationId}:${ROLE_ACL_PREVIEW_GROUP_SUFFIX[type]}`
}

function roleAclRowSnapshot(acl: Pick<RoleAcl, 'isSuperAdmin' | 'featuresJson' | 'organizationsJson'> | null): RoleAclSnapshot {
  if (!acl) return { ...EMPTY_ROLE_ACL_SNAPSHOT, features: [] }
  return normalizeRoleAclSnapshot({ isSuperAdmin: acl.isSuperAdmin, features: acl.featuresJson, organizations: acl.organizationsJson })
}

async function findTenantRole(em: EntityManager, scope: SimulationScope, roleId: string): Promise<Role | null> {
  if (!isUuid(roleId)) return null
  return findOneWithDecryption(
    em,
    Role,
    { id: roleId, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<Role>,
    undefined,
    { tenantId: scope.tenantId, organizationId: null },
  )
}

/** The role's ACL in the tenant as its editor loads it (`GET /api/auth/roles/acl`). */
async function findRoleAcl(em: EntityManager, scope: SimulationScope, role: Role): Promise<RoleAcl | null> {
  return em.findOne(RoleAcl, { role: role.id, tenantId: scope.tenantId } as FilterQuery<RoleAcl>)
}

function resolveRbac(resolve: SimulationServiceResolver | undefined): RbacService | null {
  const rbac = resolve ? resolve<RbacService>('rbacService') : undefined
  return rbac && typeof rbac.previewRoleAclChange === 'function' ? rbac : null
}

/**
 * The organization the role ACL save evaluates its write guards at: the requester's own
 * organization (`auth.orgId` of a session, which only super administrators can switch).
 */
async function requesterHomeOrganizationId(em: EntityManager, scope: SimulationScope, userId: string): Promise<string | null> {
  const user = await findOneWithDecryption(
    em,
    User,
    { id: userId, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<User>,
    { fields: ['id', 'organizationId'] },
    { tenantId: scope.tenantId, organizationId: null },
  )
  return typeof user?.organizationId === 'string' && user.organizationId.length > 0 ? user.organizationId : null
}

/**
 * The proposal must target a role of the requester's tenant (one 404 for an unknown or foreign
 * role), add only grants the ACL catalog knows (422 `invalid_proposal`), and pass the role ACL
 * write guards the requester would meet on save (evaluated at the same organization the save
 * uses) — super-admin roles and grants only for super administrators, only grants and
 * organizations within the requester's own (403 `forbidden`).
 */
async function validateRoleAclProposal(input: RoleAclPreviewProposal, ctx: SimulationValidationContext): Promise<SimulationValidationResult> {
  if (ctx.artifactId && ctx.artifactId.toLowerCase() !== input.roleId.toLowerCase()) return { ok: false, code: 'invalid_proposal' }
  const role = await findTenantRole(ctx.em, ctx.scope, input.roleId)
  if (!role) return { ok: false, code: 'artifact_unavailable' }
  const rbac = resolveRbac(ctx.resolve)
  if (!rbac || !ctx.requesterUserId) return { ok: false, code: 'forbidden' }
  const proposal = roleAclProposalSnapshot(input)
  const current = roleAclRowSnapshot(await findRoleAcl(ctx.em, ctx.scope, role))
  const catalog = await loadAclFeatureCatalog(ctx.em, ctx.scope.tenantId)
  if (findUnknownAclFeatures(proposal.features, catalog, current.features).length > 0) return { ok: false, code: 'invalid_proposal' }
  const guard = {
    em: ctx.em,
    rbacService: rbac,
    actorUserId: ctx.requesterUserId,
    tenantId: ctx.scope.tenantId,
    organizationId: (await requesterHomeOrganizationId(ctx.em, ctx.scope, ctx.requesterUserId)) ?? ctx.scope.organizationId,
  }
  try {
    await assertActorCanModifySuperAdminRoleTarget({ ...guard, targetRoleId: String(role.id) })
    await assertActorCanGrantAcl({
      ...guard,
      isSuperAdmin: proposal.isSuperAdmin,
      features: proposal.features,
      organizations: proposal.organizations,
    })
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 403) return { ok: false, code: 'forbidden' }
    throw error
  }
  return { ok: true }
}

function classify(before: readonly string[], after: readonly string[]): RoleAclPreviewCell {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const gains = after.some((feature) => !beforeSet.has(feature))
  const loses = before.some((feature) => !afterSet.has(feature))
  if (gains && loses) return 'gains_and_loses'
  if (gains) return 'gains'
  if (loses) return 'loses'
  return 'unchanged'
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const exclude = new Set(right)
  return left.filter((feature) => !exclude.has(feature))
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function caveatsOf(preview: RoleAclChangePreview | null, surface: GatedSurface | null, apiKeysIncluded: boolean): string[] {
  const caveats: string[] = [
    ROLE_ACL_PREVIEW_I18N.caveats.currentState,
    ROLE_ACL_PREVIEW_I18N.caveats.superAdminsExcluded,
    ROLE_ACL_PREVIEW_I18N.caveats.ephemeralKeysExcluded,
    ROLE_ACL_PREVIEW_I18N.caveats.organizationScope,
    ROLE_ACL_PREVIEW_I18N.caveats.notCounted,
  ]
  if (!preview) caveats.unshift(ROLE_ACL_PREVIEW_I18N.caveats.roleUnavailable)
  if (preview && (preview.truncated.users || preview.truncated.apiKeys || preview.truncated.organizations)) caveats.push(ROLE_ACL_PREVIEW_I18N.caveats.truncated)
  if (surface && !surface.pagesAvailable) caveats.push(ROLE_ACL_PREVIEW_I18N.caveats.pagesUnavailable)
  if (surface && !surface.apiRoutesAvailable) caveats.push(ROLE_ACL_PREVIEW_I18N.caveats.apiRoutesUnavailable)
  if (!apiKeysIncluded) caveats.push(ROLE_ACL_PREVIEW_I18N.caveats.apiKeysHidden)
  return caveats
}

/**
 * The stored result of a preview: one group per organization and principal type
 * (`<organizationId>:users` / `:api_keys`) counting the principals that reach the organization
 * before or after the change by outcome (k-suppressed by insights); the summary — features gained
 * and lost by some principal, the gated pages, navigation entries and API route methods some
 * principal gains or loses, and the self-lockout warnings; never a principal id.
 */
export function buildRoleAclPreviewResult(
  preview: RoleAclChangePreview | null,
  surface: GatedSurface | null,
  options: { apiKeysIncluded?: boolean } = {},
): SimulationKindResult {
  const apiKeysIncluded = options.apiKeysIncluded !== false
  if (!preview) {
    return { groups: [], coverage: {}, caveats: caveatsOf(null, surface, apiKeysIncluded), fidelity: 'observed', truncated: false, summary: {} }
  }
  const sets = preview.featureSets
  const counts = new Map<string, Record<RoleAclPreviewCell, number>>()
  const changedPairs = new Map<string, { before: number; after: number }>()
  for (const cohort of preview.cohorts) {
    for (const access of cohort.access) {
      const key = roleAclPreviewGroupKey(access.organizationId, cohort.principalType)
      const cells = counts.get(key) ?? { gains: 0, loses: 0, gains_and_loses: 0, unchanged: 0 }
      cells[classify(sets[access.before] ?? [], sets[access.after] ?? [])] += cohort.principals.length
      counts.set(key, cells)
      if (access.before !== access.after) changedPairs.set(`${access.before}:${access.after}`, { before: access.before, after: access.after })
    }
  }
  const groups: SimulationGroup[] = []
  for (const organizationId of preview.organizationIds) {
    for (const type of ['user', 'api_key'] as const) {
      const key = roleAclPreviewGroupKey(organizationId, type)
      const cells = counts.get(key)
      if (!cells) continue
      groups.push({
        key,
        labelKey: ROLE_ACL_PREVIEW_I18N.groups[type],
        sampleResourceKind: null,
        cells: ROLE_ACL_PREVIEW_CELLS.map((cell) => ({ key: cell, count: cells[cell] })),
      })
    }
  }
  const gained = new Set<string>()
  const lost = new Set<string>()
  for (const pair of changedPairs.values()) {
    for (const feature of difference(sets[pair.after] ?? [], sets[pair.before] ?? [])) gained.add(feature)
    for (const feature of difference(sets[pair.before] ?? [], sets[pair.after] ?? [])) lost.add(feature)
  }
  const summaryCounts: Record<string, number> = { organizations_evaluated: preview.organizationIds.length }
  if (surface) {
    const authorized = new Map<string, boolean>()
    const isAuthorized = (required: readonly string[], setIndex: number): boolean => {
      const key = `${setIndex}|${required.join('\u0000')}`
      const cached = authorized.get(key)
      if (cached !== undefined) return cached
      const value = authorizeFeatures(required, { grantedFeatures: sets[setIndex] ?? [] })
      authorized.set(key, value)
      return value
    }
    for (const item of surface.items) {
      const available = item.kind === 'api_route' ? surface.apiRoutesAvailable : surface.pagesAvailable
      if (!available) continue
      const keys = SURFACE_COUNT_KEYS[item.kind]
      if (summaryCounts[keys.gained] === undefined) summaryCounts[keys.gained] = 0
      if (summaryCounts[keys.lost] === undefined) summaryCounts[keys.lost] = 0
      let itemGained = false
      let itemLost = false
      for (const pair of changedPairs.values()) {
        const before = isAuthorized(item.requiredFeatures, pair.before)
        const after = isAuthorized(item.requiredFeatures, pair.after)
        if (!before && after) itemGained = true
        if (before && !after) itemLost = true
        if (itemGained && itemLost) break
      }
      if (itemGained) summaryCounts[keys.gained] += 1
      if (itemLost) summaryCounts[keys.lost] += 1
    }
  }
  const warnings: string[] = []
  if (preview.self) {
    const before = sets[preview.self.before] ?? []
    const after = sets[preview.self.after] ?? []
    if (authorizeFeatures([ROLE_ACL_MANAGE_FEATURE], { grantedFeatures: before }) && !authorizeFeatures([ROLE_ACL_MANAGE_FEATURE], { grantedFeatures: after })) {
      warnings.push(ROLE_ACL_PREVIEW_I18N.warnings.selfLockoutAclManage)
    }
    const hadAccess = preview.self.organizationAllowedBefore && before.length > 0
    const hasAccess = preview.self.organizationAllowedAfter && after.length > 0
    if (hadAccess && !hasAccess) warnings.push(ROLE_ACL_PREVIEW_I18N.warnings.selfLockoutOrganization)
  }
  const truncated = preview.truncated.users || preview.truncated.apiKeys || preview.truncated.organizations
  return {
    groups,
    coverage: {},
    caveats: caveatsOf(preview, surface, apiKeysIncluded),
    fidelity: 'observed',
    truncated,
    summary: {
      warnings,
      counts: summaryCounts,
      lists: {
        features_gained: Array.from(gained).sort(compareCodeUnits),
        features_lost: Array.from(lost).sort(compareCodeUnits),
      },
    },
  }
}

function countPrincipals(preview: RoleAclChangePreview | null): number {
  if (!preview) return 0
  return preview.cohorts.reduce((sum, cohort) => sum + cohort.principals.length, 0)
}

type AffectedPrincipal = {
  type: RoleAclPrincipalType
  id: string
  groupKeys: Set<string>
  gained: Set<string>
  lost: Set<string>
}

/** The principals whose effective features change in at least one evaluated organization. */
export function affectedPrincipals(preview: RoleAclChangePreview, includeApiKeys: boolean): AffectedPrincipal[] {
  const byId = new Map<string, AffectedPrincipal>()
  for (const cohort of preview.cohorts) {
    if (cohort.principalType === 'api_key' && !includeApiKeys) continue
    const changed = cohort.access.filter((access) => access.before !== access.after)
    if (changed.length === 0) continue
    for (const principal of cohort.principals) {
      const key = `${cohort.principalType}:${principal.id}`
      const entry = byId.get(key) ?? { type: cohort.principalType, id: principal.id, groupKeys: new Set<string>(), gained: new Set<string>(), lost: new Set<string>() }
      for (const access of changed) {
        entry.groupKeys.add(roleAclPreviewGroupKey(access.organizationId, cohort.principalType))
        for (const feature of difference(preview.featureSets[access.after] ?? [], preview.featureSets[access.before] ?? [])) entry.gained.add(feature)
        for (const feature of difference(preview.featureSets[access.before] ?? [], preview.featureSets[access.after] ?? [])) entry.lost.add(feature)
      }
      byId.set(key, entry)
    }
  }
  return Array.from(byId.values()).sort((left, right) => (
    left.type === right.type ? compareCodeUnits(left.id, right.id) : left.type === 'user' ? -1 : 1
  ))
}

async function principalLabels(
  em: EntityManager,
  scope: SimulationScope,
  principals: readonly AffectedPrincipal[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  const userIds = principals.filter((principal) => principal.type === 'user').map((principal) => principal.id)
  const keyIds = principals.filter((principal) => principal.type === 'api_key').map((principal) => principal.id)
  if (userIds.length > 0) {
    const users = await findWithDecryption(
      em,
      User,
      { id: { $in: userIds }, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<User>,
      { fields: ['id', 'email', 'name', 'organizationId', 'tenantId'] },
      { tenantId: scope.tenantId, organizationId: null },
    )
    for (const user of users) {
      const name = typeof user.name === 'string' ? user.name.trim() : ''
      const email = typeof user.email === 'string' ? user.email.trim() : ''
      const label = name && email ? `${name} <${email}>` : name || email
      if (label) labels.set(`user:${String(user.id).toLowerCase()}`, label)
    }
  }
  if (keyIds.length > 0) {
    const keys = await em.find(ApiKey, { id: { $in: keyIds }, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<ApiKey>, { fields: ['id', 'name', 'keyPrefix'] })
    for (const key of keys) {
      const name = typeof key.name === 'string' ? key.name.trim() : ''
      const prefix = typeof key.keyPrefix === 'string' ? key.keyPrefix.trim() : ''
      const label = name && prefix ? `${name} (${prefix}…)` : name || prefix
      if (label) labels.set(`api_key:${String(key.id).toLowerCase()}`, label)
    }
  }
  return labels
}

async function organizationLabels(em: EntityManager, scope: SimulationScope, organizationIds: readonly string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (organizationIds.length === 0) return labels
  const organizations = await findWithDecryption(
    em,
    Organization,
    { id: { $in: [...organizationIds] }, tenant: scope.tenantId, deletedAt: null } as FilterQuery<Organization>,
    { fields: ['id', 'name'] },
    { tenantId: scope.tenantId, organizationId: null },
  )
  for (const organization of organizations) {
    const name = typeof organization.name === 'string' ? organization.name.trim() : ''
    if (name) labels.set(String(organization.id).toLowerCase(), name)
  }
  return labels
}

/**
 * The affected principals of a preview, resolved live for the viewer (S8): the preview is computed
 * again on the current roles, users and API keys within the viewer's current organization scope;
 * hidden super administrators and principals of other organizations never appear; API keys only
 * for viewers holding `api_keys.view`. Paged (≤ 100); labels are read for the page only.
 */
async function listAffectedPrincipals(input: RoleAclPreviewProposal, ctx: SimulationLiveRecordsContext): Promise<SimulationLiveRecordsPage> {
  const rbac = resolveRbac(ctx.resolve)
  if (!rbac) throw new Error('[internal] The RBAC service is not available for the role permission preview')
  const includeApiKeys = await ctx.hasFeatures([API_KEYS_VIEW_FEATURE])
  const preview = await rbac.previewRoleAclChange(ctx.scope.tenantId, input.roleId, roleAclProposalSnapshot(input), {
    em: ctx.em,
    organizationIds: ctx.organizationIds,
    principalOrganizationIds: ctx.organizationIds,
    includeApiKeys,
  })
  if (!preview) return { items: [], total: 0, notes: [ROLE_ACL_PREVIEW_I18N.caveats.roleUnavailable] }
  const notes = preview.currentExists && sameRoleAcl(preview.current, preview.proposed) ? [ROLE_ACL_PREVIEW_I18N.notes.proposalInEffect] : []
  const principals = affectedPrincipals(preview, includeApiKeys)
  const start = (Math.max(1, ctx.page) - 1) * ctx.pageSize
  const page = principals.slice(start, start + ctx.pageSize)
  const labels = await principalLabels(ctx.em, ctx.scope, page)
  const items: SimulationLiveRecord[] = page.map((principal) => ({
    id: principal.id,
    type: principal.type,
    label: labels.get(`${principal.type}:${principal.id}`) ?? null,
    href: principal.type === 'user' ? `/backend/users/${encodeURIComponent(principal.id)}/edit` : null,
    groupKeys: Array.from(principal.groupKeys).sort(compareCodeUnits),
    counts: {
      organizations: principal.groupKeys.size,
      features_gained: principal.gained.size,
      features_lost: principal.lost.size,
    },
  }))
  const groupOrganizations = new Set<string>()
  for (const cohort of preview.cohorts) {
    for (const access of cohort.access) groupOrganizations.add(access.organizationId)
  }
  const names = await organizationLabels(ctx.em, ctx.scope, Array.from(groupOrganizations))
  const groupLabels: Record<string, string> = {}
  for (const organizationId of groupOrganizations) {
    const name = names.get(organizationId)
    if (!name) continue
    groupLabels[roleAclPreviewGroupKey(organizationId, 'user')] = name
    groupLabels[roleAclPreviewGroupKey(organizationId, 'api_key')] = name
  }
  return { items, total: principals.length, notes, groupLabels }
}

/**
 * `auth.role_acl_preview` (spec S8): what saving a role's ACL would change for the principals
 * holding the role, computed inline from the current roles, users and API keys
 * (`RbacService.previewRoleAclChange`) and stored as counts only for 24 hours; the affected
 * principals are listed live on read. Sources: role ACLs (`auth.acl.manage`) and users
 * (`auth.users.list`); the access-log row (`insights.simulation.permission_preview`) is written by
 * insights before the preview is computed and before principals are listed. Applying is the role
 * editor's own save (optimistic lock, or the fingerprint check when the ACL has no `updatedAt`).
 */
export const roleAclPreviewKind = defineSimulationKind<RoleAclPreviewProposal, null>({
  kind: ROLE_ACL_PREVIEW_KIND,
  artifactKind: ROLE_ACL_PREVIEW_ARTIFACT_KIND,
  labelKey: ROLE_ACL_PREVIEW_I18N.label,
  requiredFeatures: [...ROLE_ACL_PREVIEW_FEATURES],
  inputSchema: roleAclPreviewProposalSchema,
  version: ROLE_ACL_PREVIEW_VERSION,
  cellKeys: [...ROLE_ACL_PREVIEW_CELLS],
  ttlHours: ROLE_ACL_PREVIEW_TTL_HOURS,
  execution: 'inline',
  accessLogResourceKind: SIMULATION_PERMISSION_PREVIEW_ACCESS_LOG_KIND,
  async readArtifactVersion(ctx, ref): Promise<SimulationArtifactVersion | null> {
    const role = await findTenantRole(ctx.em, ctx.scope, ref.artifactId ?? ref.input.roleId)
    if (!role) return null
    const acl = await findRoleAcl(ctx.em, ctx.scope, role)
    const updatedAt = acl?.updatedAt instanceof Date && !Number.isNaN(acl.updatedAt.getTime()) ? acl.updatedAt.toISOString() : null
    return { artifactId: String(role.id).toLowerCase(), updatedAt, fingerprint: fingerprintRoleAcl(roleAclRowSnapshot(acl)) }
  },
  fingerprintProposal(input) {
    return fingerprintRoleAcl(roleAclProposalSnapshot(input))
  },
  validate: validateRoleAclProposal,
  async run(input, ctx) {
    if (!ctx.inline) throw new Error('[internal] The role permission preview runs inline only')
    const rbac = resolveRbac(ctx.inline.resolve)
    if (!rbac) throw new Error('[internal] The RBAC service is not available for the role permission preview')
    const surfaceLoad: Promise<GatedSurface | null> = loadGatedSurface().catch(() => null)
    const apiKeysIncluded = await ctx.hasFeatures([API_KEYS_VIEW_FEATURE])
    const preview = await rbac.previewRoleAclChange(ctx.scope.tenantId, input.roleId, roleAclProposalSnapshot(input), {
      em: ctx.em,
      organizationIds: ctx.inline.organizationIds,
      principalOrganizationIds: ctx.inline.organizationIds,
      selfUserId: ctx.requesterUserId,
      selfOrganizationId: ctx.scope.organizationId,
      includeApiKeys: apiKeysIncluded,
      now: new Date(ctx.now()),
    })
    const surface = (await surfaceLoad) ?? { items: [], pagesAvailable: false, apiRoutesAvailable: false }
    if (!preview) return { status: 'done', recordsProcessed: 0, result: buildRoleAclPreviewResult(null, null, { apiKeysIncluded }) }
    return { status: 'done', recordsProcessed: countPrincipals(preview), result: buildRoleAclPreviewResult(preview, surface, { apiKeysIncluded }) }
  },
  applyHref({ artifactId, runId }) {
    if (!artifactId) return null
    return `/backend/roles/${encodeURIComponent(artifactId)}/edit?simulationRunId=${encodeURIComponent(runId)}`
  },
  liveRecords: {
    requiredFeatures: [...ROLE_ACL_PREVIEW_RECORD_FEATURES],
    list: listAffectedPrincipals,
  },
})
