"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { Plus } from 'lucide-react'

const DEFAULT_PAGE_SIZE = 100

type TeamRoleRow = {
  id: string
  name: string
  teamId: string | null
}

type TeamRolesResponse = {
  items?: Array<Record<string, unknown>>
}

type UserRow = {
  id: string
  email: string
  organizationName?: string | null
}

type UsersResponse = {
  items?: UserRow[]
}

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

export default function BookingTeamMemberCreatePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [roles, setRoles] = React.useState<TeamRoleRow[]>([])
  const initialTeamId = searchParams?.get('teamId')?.trim() || null
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(initialTeamId)
  const [userOptions, setUserOptions] = React.useState<LookupSelectItem[]>([])
  const [teamOptions, setTeamOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const scopeVersion = useOrganizationScopeVersion()
  const [roleSearch, setRoleSearch] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    async function loadRoles() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: String(DEFAULT_PAGE_SIZE) })
        const call = await apiCall<TeamRolesResponse>(`/api/booking/team-roles?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const nextRoles = items
          .map(mapTeamRole)
          .filter((role): role is TeamRoleRow => role !== null)
        if (!cancelled) setRoles(nextRoles)
      } catch {
        if (!cancelled) setRoles([])
      }
    }
    loadRoles()
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    async function loadTeams() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const call = await apiCall<TeamsResponse>(`/api/booking/teams?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const options = items
          .map((team) => {
            const id = typeof team.id === 'string' ? team.id : null
            const name = typeof team.name === 'string' ? team.name : null
            if (!id || !name) return null
            return { value: id, label: name }
          })
          .filter((entry): entry is { value: string; label: string } => entry !== null)
        if (!cancelled) setTeamOptions(options)
      } catch {
        if (!cancelled) setTeamOptions([])
      }
    }
    loadTeams()
    return () => { cancelled = true }
  }, [scopeVersion])

  const filteredRoles = React.useMemo(
    () => filterRolesByTeam(roles, selectedTeamId),
    [roles, selectedTeamId],
  )
  const roleOptions = React.useMemo(
    () => filteredRoles.map((role) => ({ value: role.id, label: role.name })),
    [filteredRoles],
  )
  const filteredRoleOptions = React.useMemo(() => {
    const query = roleSearch.trim().toLowerCase()
    if (!query) return roleOptions
    return roleOptions.filter((option) => (
      option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query)
    ))
  }, [roleOptions, roleSearch])
  const createRoleHref = React.useMemo(() => {
    const params = new URLSearchParams()
    if (selectedTeamId) params.set('teamId', selectedTeamId)
    const query = params.toString()
    return `/backend/booking/team-roles/create${query ? `?${query}` : ''}`
  }, [selectedTeamId])

  React.useEffect(() => {
    setRoleSearch('')
  }, [selectedTeamId])

  const fetchUserOptions = React.useCallback(async (query?: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (query && query.trim().length) params.set('search', query.trim())
    const call = await apiCall<UsersResponse>(`/api/auth/users?${params.toString()}`)
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const options = items
      .map((user) => {
        if (!user?.id || !user?.email) return null
        return {
          id: user.id,
          title: user.email,
          subtitle: user.organizationName ?? null,
        }
      })
      .filter((option): option is LookupSelectItem => option !== null)
    setUserOptions(options)
    return options
  }, [])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'userId',
      label: t('booking.teamMembers.form.fields.user', 'User'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <LookupSelect
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(next)}
          options={userOptions}
          fetchOptions={fetchUserOptions}
          placeholder={t('booking.teamMembers.form.fields.user.placeholder', 'Select a user')}
          searchPlaceholder={t('booking.teamMembers.form.fields.user.search', 'Search users')}
          emptyLabel={t('booking.teamMembers.form.fields.user.empty', 'No users found')}
          selectedHintLabel={(id) => t('booking.teamMembers.form.fields.user.selected', 'Selected user: {{id}}', { id })}
        />
      ),
    },
    {
      id: 'teamId',
      label: t('booking.teamMembers.form.fields.team', 'Team'),
      type: 'custom',
      component: ({ value, setValue, setFormValue, values, disabled }) => {
        const currentValue = typeof value === 'string' ? value : ''
        return (
          <select
            className="w-full h-9 rounded border px-2 text-sm"
            value={currentValue}
            onChange={(event) => {
              const nextValue = event.target.value || undefined
              const nextTeamId = event.target.value || null
              setValue(nextValue)
              setSelectedTeamId(nextTeamId)
              if (!setFormValue) return
              const roleIds = Array.isArray(values?.roleIds)
                ? values?.roleIds.filter((item): item is string => typeof item === 'string')
                : []
              const allowedRoleIds = buildAllowedRoleIdSet(roles, nextTeamId)
              const nextRoleIds = roleIds.filter((roleId) => allowedRoleIds.has(roleId))
              if (nextRoleIds.length !== roleIds.length) {
                setFormValue('roleIds', nextRoleIds)
              }
            }}
            data-crud-focus-target=""
            disabled={disabled}
          >
            <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
            {teamOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )
      },
    },
    {
      id: 'displayName',
      label: t('booking.teamMembers.form.fields.displayName', 'Display name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('booking.teamMembers.form.fields.description', 'Description'),
      type: 'richtext',
      editor: 'uiw',
    },
    {
      id: 'roleIds',
      label: t('booking.teamMembers.form.fields.roles', 'Roles'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        const selectedValues = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : []
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => router.push(createRoleHref)}
                disabled={disabled}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {t('booking.teamMembers.form.actions.defineRole', 'Define new role')}
              </Button>
            </div>
            <input
              className="w-full h-8 rounded border px-2 text-sm"
              placeholder={t('ui.forms.listbox.searchPlaceholder', 'Search...')}
              value={roleSearch}
              onChange={(event) => setRoleSearch(event.target.value)}
              data-crud-focus-target=""
              disabled={disabled}
            />
            <div className="rounded border max-h-48 overflow-auto divide-y">
              {filteredRoleOptions.map((option) => {
                const isSelected = selectedValues.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      const next = new Set(selectedValues)
                      if (isSelected) {
                        next.delete(option.value)
                      } else {
                        next.add(option.value)
                      }
                      setValue(Array.from(next))
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${isSelected ? 'bg-muted' : ''}`}
                    disabled={disabled}
                  >
                    <span className="inline-flex items-center gap-2">
                      <input type="checkbox" className="size-4" readOnly checked={isSelected} />
                      <span>{option.label}</span>
                    </span>
                  </button>
                )
              })}
              {!filteredRoleOptions.length ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t('ui.forms.listbox.noMatches', 'No matches')}
                </div>
              ) : null}
            </div>
          </div>
        )
      },
    },
    {
      id: 'tags',
      label: t('booking.teamMembers.form.fields.tags', 'Tags'),
      type: 'tags',
      placeholder: t('booking.teamMembers.form.fields.tags.placeholder', 'Add tags'),
    },
    {
      id: 'isActive',
      label: t('booking.teamMembers.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [createRoleHref, fetchUserOptions, filteredRoleOptions, roleSearch, roles, router, t, teamOptions, userOptions])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const customFields = collectCustomFieldValues(values)
    const payload: Record<string, unknown> = {
      teamId: values.teamId ? String(values.teamId) : null,
      userId: values.userId ? String(values.userId) : null,
      displayName: values.displayName ? String(values.displayName) : '',
      description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
      roleIds: Array.isArray(values.roleIds) ? values.roleIds : [],
      tags: Array.isArray(values.tags) ? values.tags : [],
      isActive: values.isActive ?? true,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    const { result } = await createCrud<{ id?: string }>('booking/team-members', payload, {
      errorMessage: t('booking.teamMembers.form.errors.create', 'Failed to create team member.'),
    })
    const memberId = typeof result?.id === 'string' ? result.id : null
    if (memberId) {
      router.push(`/backend/booking/team-members/${encodeURIComponent(memberId)}?tab=availability&created=1`)
      return
    }
    router.push('/backend/booking/team-members')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('booking.teamMembers.form.createTitle', 'Add team member')}
          backHref="/backend/booking/team-members"
          cancelHref="/backend/booking/team-members"
          submitLabel={t('booking.teamMembers.form.actions.create', 'Create')}
          fields={fields}
          initialValues={{ isActive: true, roleIds: [], tags: [], teamId: initialTeamId }}
          entityId={E.booking.booking_team_member}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}

function mapTeamRole(item: Record<string, unknown>): TeamRoleRow | null {
  const id = typeof item.id === 'string' ? item.id : ''
  if (!id) return null
  const name = typeof item.name === 'string' && item.name.trim().length ? item.name.trim() : id
  const teamId = typeof item.teamId === 'string'
    ? item.teamId
    : typeof item.team_id === 'string'
      ? item.team_id
      : null
  return { id, name, teamId }
}

function filterRolesByTeam(roles: TeamRoleRow[], teamId: string | null): TeamRoleRow[] {
  if (!teamId) return roles.filter((role) => role.teamId == null)
  return roles.filter((role) => role.teamId == null || role.teamId === teamId)
}

function buildAllowedRoleIdSet(roles: TeamRoleRow[], teamId: string | null): Set<string> {
  return new Set(filterRolesByTeam(roles, teamId).map((role) => role.id))
}
