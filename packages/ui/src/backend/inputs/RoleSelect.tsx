"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '../utils/apiCall'
import { TagsInput, type TagsInputOption } from './TagsInput'

type RoleListResponse = {
  items?: Array<{ id?: string | null; name?: string | null }>
}

export type FetchRoleNameOptionsParams = {
  tenantId?: string | null
  includeSuperAdmin?: boolean
}

/**
 * Fetches roles as NAME-valued options (`{ value: name, label: name }`).
 *
 * Distinct from the auth module's `fetchRoleOptions`, which is id-valued for
 * user-to-role assignment. Use this wherever a role is referenced by name.
 * Returns `[]` on failure — including a 403 when the caller lacks
 * `auth.roles.list` — so callers degrade to free text rather than breaking.
 */
export async function fetchRoleNameOptions(
  query?: string,
  params?: FetchRoleNameOptionsParams,
): Promise<TagsInputOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '20' })
  if (query && query.trim()) searchParams.set('search', query.trim())
  const tenantId = typeof params?.tenantId === 'string' && params.tenantId.trim().length
    ? params.tenantId.trim()
    : null
  if (tenantId) searchParams.set('tenantId', tenantId)

  try {
    const call = await apiCall<RoleListResponse>(
      `/api/auth/roles?${searchParams.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok || !Array.isArray(call.result?.items)) return []
    return call.result.items
      .map((item) => {
        const name = typeof item?.name === 'string' ? item.name.trim() : ''
        if (!name) return null
        if (name === 'superadmin' && !params?.includeSuperAdmin) return null
        return { value: name, label: name }
      })
      .filter((option): option is TagsInputOption => !!option)
  } catch {
    return []
  }
}

export interface RoleSelectProps {
  /** Selected role names. Roles are referenced by name, not id — see below. */
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Restrict suggestions to a tenant. Only honoured for super admins by the API. */
  tenantId?: string | null
  /** Include the `superadmin` role in suggestions. Defaults to false. */
  includeSuperAdmin?: boolean
}

/**
 * RoleSelect — multi-select of role NAMES.
 *
 * Values are role names rather than ids on purpose: role rows are tenant-scoped,
 * while the definitions that reference them (code-registered workflows, seeded
 * example JSON) are shared across tenants, so an id would not resolve. Runtime
 * authorization also matches on name.
 *
 * Free text stays allowed so a definition can reference a role that does not
 * exist in the current tenant, and so the field degrades to its previous
 * behaviour when the caller lacks `auth.roles.list`.
 */
export function RoleSelect({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  tenantId,
  includeSuperAdmin = false,
}: RoleSelectProps) {
  const t = useT()

  const loadSuggestions = React.useCallback(
    (query?: string) => fetchRoleNameOptions(query, { tenantId, includeSuperAdmin }),
    [includeSuperAdmin, tenantId],
  )

  return (
    <TagsInput
      value={value}
      onChange={onChange}
      loadSuggestions={loadSuggestions}
      allowCustomValues
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder || t('ui.inputs.roleSelect.placeholder', 'Select or type a role name')}
    />
  )
}
