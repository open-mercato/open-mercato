"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { resolveCatalogLabel } from '../../../lib/catalogLabels'

export type IncidentRoleOption = {
  id: string
  key: string | null
  label: string
}

type RoleRecord = {
  id?: string | null
  key?: string | null
  label?: string | null
}

type RolesResponse = {
  items?: RoleRecord[]
}

const NONE_VALUE = '__none__'

let cachedRoles: IncidentRoleOption[] | null = null
let pendingRolesLoad: Promise<IncidentRoleOption[]> | null = null

function cleanText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function loadRoles(): Promise<IncidentRoleOption[]> {
  if (cachedRoles) return cachedRoles
  if (!pendingRolesLoad) {
    pendingRolesLoad = apiCall<RolesResponse>(
      '/api/incidents/roles?isActive=true&page=1&pageSize=100',
      undefined,
      { fallback: { items: [] } },
    )
      .then((result) => {
        const items = result.ok && result.result?.items ? result.result.items : []
        const options = items
          .map((item): IncidentRoleOption | null => {
            const id = cleanText(item.id)
            if (!id) return null
            const key = cleanText(item.key)
            const label = cleanText(item.label)
            return { id, key: key.length ? key : null, label: label.length ? label : id }
          })
          .filter((option): option is IncidentRoleOption => option !== null)
        cachedRoles = options
        return options
      })
      .catch(() => {
        cachedRoles = []
        return []
      })
      .finally(() => {
        pendingRolesLoad = null
      })
  }
  return pendingRolesLoad
}

export function useIncidentRoles(): IncidentRoleOption[] {
  const [roles, setRoles] = React.useState<IncidentRoleOption[]>(cachedRoles ?? [])
  React.useEffect(() => {
    let active = true
    loadRoles()
      .then((options) => {
        if (active) setRoles(options)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])
  return roles
}

export function useRoleLabel(): (roleId: string | null | undefined) => string | null {
  const t = useT()
  const roles = useIncidentRoles()
  return React.useCallback(
    (roleId: string | null | undefined) => {
      const trimmed = cleanText(roleId)
      if (!trimmed) return null
      const match = roles.find((role) => role.id === trimmed)
      if (!match) return trimmed
      return resolveCatalogLabel(t, 'role', match.key, match.label)
    },
    [roles, t],
  )
}

type RoleSelectProps = {
  id?: string
  value: string | null | undefined
  onChange: (value: string | null) => void
  disabled?: boolean
  placeholder?: string
  nullable?: boolean
}

export function RoleSelect({ id, value, onChange, disabled, placeholder, nullable = true }: RoleSelectProps) {
  const t = useT()
  const roles = useIncidentRoles()
  const current = cleanText(value)
  return (
    <Select
      value={current.length ? current : nullable ? NONE_VALUE : ''}
      onValueChange={(next) => onChange(next === NONE_VALUE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder ?? t('incidents.roleSelect.placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {nullable ? <SelectItem value={NONE_VALUE}>{t('incidents.roleSelect.none')}</SelectItem> : null}
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {resolveCatalogLabel(t, 'role', role.key, role.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
