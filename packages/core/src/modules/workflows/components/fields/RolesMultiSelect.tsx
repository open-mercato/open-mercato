'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { TagsInput, type TagsInputOption } from '@open-mercato/ui/backend/inputs/TagsInput'

type RoleListResponse = {
  items?: Array<{ id?: string | null; name?: string | null }>
}

export type RolesMultiSelectProps = {
  id?: string
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

export function RolesMultiSelect({ id, value, onChange, disabled }: RolesMultiSelectProps) {
  const t = useT()
  const [lookupFailed, setLookupFailed] = React.useState(false)

  const loadRoleSuggestions = React.useCallback(async (query?: string): Promise<TagsInputOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '100' })
    const trimmedQuery = typeof query === 'string' ? query.trim() : ''
    if (trimmedQuery) params.set('search', trimmedQuery)
    try {
      const call = await apiCall<RoleListResponse>(
        `/api/auth/roles?${params.toString()}`,
        // The roles lookup is optional: editors without auth.roles.list fall back
        // to free-text entry, so suppress the global forbidden/unauthorized
        // redirect handling (and its toast) for this call.
        { headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
        { fallback: { items: [] } },
      )
      if (!call.ok || !Array.isArray(call.result?.items)) {
        setLookupFailed(true)
        return []
      }
      setLookupFailed(false)
      const names = call.result.items
        .map((item) => (typeof item?.name === 'string' ? item.name.trim() : ''))
        .filter((name) => name.length > 0)
      return Array.from(new Set(names)).map((name) => ({ value: name, label: name }))
    } catch {
      setLookupFailed(true)
      return []
    }
  }, [])

  return (
    <div id={id}>
      <TagsInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        allowCustomValues
        loadSuggestions={loadRoleSuggestions}
        placeholder={t('workflows.rolesSelect.placeholder')}
      />
      {lookupFailed ? (
        <p className="text-xs text-muted-foreground mt-1">
          {t('workflows.rolesSelect.lookupUnavailable')}
        </p>
      ) : null}
    </div>
  )
}
