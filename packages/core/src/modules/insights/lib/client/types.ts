import type {
  ExplainActorView,
  ExplainCauseFrameView,
  ExplainCauseView,
  ExplainChainEntryView,
  ExplainDescriptorsResponse,
  ExplainFieldResponse,
  ExplainGapView,
  ExplainHintView,
  ExplainLogResponse,
  ExplainOverviewResponse,
  ExplainPrincipalView,
  ExplainValueView,
  ExplainViewerView,
} from '../../data/validators'

export type {
  ExplainActorView,
  ExplainCauseFrameView,
  ExplainCauseView,
  ExplainChainEntryView,
  ExplainDescriptorsResponse,
  ExplainFieldResponse,
  ExplainGapView,
  ExplainHintView,
  ExplainLogResponse,
  ExplainOverviewResponse,
  ExplainPrincipalView,
  ExplainValueView,
  ExplainViewerView,
}

export type ExplainResourceDescriptorView = ExplainDescriptorsResponse['resources'][number]

export type ExplainOverviewFieldView = ExplainOverviewResponse['fields'][number]

export type ExplainRequestParams = {
  resourceKind: string
  resourceId: string
  field?: string | null
  itemId?: string | null
  before?: string | null
  limit?: number
}

export type ExplainFetchOutcome<TBody> =
  | { status: 'ok'; body: TBody }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error'; httpStatus: number | null }

export const ACCESS_DECISIONS = ['granted', 'denied'] as const

export type AccessDecision = (typeof ACCESS_DECISIONS)[number]

export const ACCESS_REASONS = [
  'missing_feature',
  'organization_out_of_scope',
  'user_acl_override',
  'module_disabled',
  'feature_removed',
  'not_determinable',
] as const

export type AccessReason = (typeof ACCESS_REASONS)[number]

export const ACCESS_SOURCES = ['super_admin', 'user_acl', 'roles', 'api_key', 'none'] as const

export type AccessSource = (typeof ACCESS_SOURCES)[number]

export const ACCESS_CHANGE_KINDS = ['user_acl', 'role_acl', 'user_roles'] as const

export type AccessChangeKind = (typeof ACCESS_CHANGE_KINDS)[number]

export type AccessRequirementView = {
  feature: string
  granted: boolean
}

export type AccessRoleView = {
  id: string
  name: string | null
  appliesToOrganization: boolean
}

export type AccessChangeView = {
  logId: string
  at: string
  kind: AccessChangeKind
  actionLabel: string | null
}

export type AccessDetailView = {
  source: AccessSource | null
  organizationAllowed: boolean | null
  roles: AccessRoleView[]
  grantingRoles: AccessRoleView[]
  recentChanges: AccessChangeView[] | null
}

export type AccessSummaryView = {
  key: string
  params: Record<string, string | number | boolean | null>
}

export type AccessExplanationView = {
  decision: AccessDecision
  required: AccessRequirementView[]
  reasons: AccessReason[]
  summary: AccessSummaryView | null
  detail: AccessDetailView | null
  confidence: 'proven' | 'inferred' | 'unknown'
}

export function isExplainFieldResponse(
  body: ExplainFieldResponse | ExplainOverviewResponse,
): body is ExplainFieldResponse {
  return Array.isArray((body as ExplainFieldResponse).chain)
}
