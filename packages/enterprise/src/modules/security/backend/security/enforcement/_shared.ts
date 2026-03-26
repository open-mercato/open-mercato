import type { EnforcementPolicyFormValue } from '../../../components/EnforcementPolicyForm'

export type EnforcementPolicyDto = {
  id: string
  scope: 'platform' | 'tenant' | 'organisation'
  tenantId: string | null
  tenantName?: string | null
  organizationId: string | null
  organizationName?: string | null
  isEnforced: boolean
  allowedMethods: string[] | null
  enforcementDeadline: string | null
  enforcedBy: string
  createdAt: string
  updatedAt: string
}

export type EnforcementPoliciesResponse = {
  items: EnforcementPolicyDto[]
}

export function toPayload(values: EnforcementPolicyFormValue): Record<string, unknown> {
  return {
    scope: values.scope,
    tenantId: values.scope === 'platform' ? null : (values.tenantId || null),
    organizationId: values.scope === 'organisation' ? (values.organizationId || null) : null,
    isEnforced: values.isEnforced,
    allowedMethods: values.allowedMethods.length ? values.allowedMethods : null,
    enforcementDeadline: values.enforcementDeadline ? new Date(values.enforcementDeadline).toISOString() : null,
  }
}
