"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { AttachmentsSection, TagsSection, type TagOption, type TagsSectionLabels } from '@open-mercato/ui/backend/detail'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Plus } from 'lucide-react'

const DEFAULT_PAGE_SIZE = 100

export type TeamMemberFormValues = {
  id?: string
  teamId?: string | null
  userId?: string | null
  displayName?: string | null
  description?: string | null
  roleIds?: string[]
  tags?: string[]
  isActive?: boolean
} & Record<string, unknown>

export type TeamMemberFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  initialValues: TeamMemberFormValues
  onSubmit: (values: TeamMemberFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
  tagsSection?: TeamMemberTagsSectionConfig
}

type TeamRoleRow = {
  id: string
  name: string
  teamId: string | null
}

type TeamRolesResponse = {
  items?: Array<Record<string, unknown>>
}

type UsersResponse = {
  items?: Array<{ id?: string; email?: string; organizationName?: string | null }>
}

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

type TeamMemberTagsSectionConfig = {
  title: string
  tags: TagOption[]
  onChange: (next: TagOption[]) => void
  loadOptions: (query?: string) => Promise<TagOption[]>
  createTag: (label: string) => Promise<TagOption>
  onSave: (payload: { next: TagOption[]; added: TagOption[]; removed: TagOption[] }) => Promise<void>
  labels: TagsSectionLabels
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export const buildTeamMemberPayload = (
  values: TeamMemberFormValues,
  options: { id?: string } = {},
): Record<string, unknown> => {
  const roleIds = Array.isArray(values.roleIds)
    ? values.roleIds.filter((item): item is string => typeof item === 'string')
    : []
  const tags = Array.isArray(values.tags)
    ? values.tags.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : null
  const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
  return {
    ...(options.id ? { id: options.id } : {}),
    teamId: values.teamId ? String(values.teamId) : null,
    userId: values.userId ? String(values.userId) : null,
    displayName: typeof values.displayName === 'string' ? values.displayName : '',
    description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
    roleIds,
    ...(tags ? { tags } : {}),
    isActive: values.isActive ?? true,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function TeamMemberForm(props: TeamMemberFormProps) {
  const {
    title,
    submitLabel,
    backHref,
    cancelHref,
    initialValues,
    onSubmit,
    onDelete,
    isLoading,
    loadingMessage,
    tagsSection,
  } = props
  const translate = useT()
  const recordId = typeof initialValues?.id === 'string' ? initialValues.id : null
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [roles, setRoles] = React.useState<TeamRoleRow[]>([])
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null)
  const [userOptions, setUserOptions] = React.useState<LookupSelectItem[]>([])
  const [teamOptions, setTeamOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [roleSearch, setRoleSearch] = React.useState('')

  const resolvedTeamId = typeof initialValues.teamId === 'string' && initialValues.teamId.trim().length
    ? initialValues.teamId
    : null
  const resolvedUserId = typeof initialValues.userId === 'string' && initialValues.userId.trim().length
    ? initialValues.userId
    : null

  React.useEffect(() => {
    setSelectedTeamId(resolvedTeamId)
  }, [resolvedTeamId])

  React.useEffect(() => {
    let cancelled = false
    async function loadRoles() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: String(DEFAULT_PAGE_SIZE) })
        const call = await apiCall<TeamRolesResponse>(`/api/staff/team-roles?${params.toString()}`)
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
        const call = await apiCall<TeamsResponse>(`/api/staff/teams?${params.toString()}`)
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

  React.useEffect(() => {
    if (!resolvedUserId) return
    const userId = resolvedUserId
    if (userOptions.some((option) => option.id === resolvedUserId)) return
    let cancelled = false
    async function loadSelectedUser() {
      try {
        const call = await apiCall<UsersResponse>(`/api/auth/users?id=${encodeURIComponent(userId)}`)
        const entry = Array.isArray(call.result?.items) ? call.result.items[0] : null
        const entryId = typeof entry?.id === 'string' ? entry.id : null
        const entryEmail = typeof entry?.email === 'string' ? entry.email : null
        if (!entryId || !entryEmail) return
        if (!cancelled) {
          setUserOptions((prev) => {
            if (prev.some((option) => option.id === entryId)) return prev
            return [{ id: entryId, title: entryEmail, subtitle: entry?.organizationName ?? null }, ...prev]
          })
        }
      } catch {
        if (!cancelled) setUserOptions((prev) => prev)
      }
    }
    loadSelectedUser()
    return () => { cancelled = true }
  }, [resolvedUserId, userOptions])

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
    return `/backend/staff/team-roles/create${query ? `?${query}` : ''}`
  }, [selectedTeamId])
  const createTeamHref = '/backend/staff/teams/create'

  React.useEffect(() => {
    setRoleSearch('')
  }, [selectedTeamId])

  const fetchUserOptions = React.useCallback(async (query?: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (query && query.trim().length) params.set('search', query.trim())
    const call = await apiCall<UsersResponse>(`/api/auth/users?${params.toString()}`)
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const options = items
      .map((user): LookupSelectItem | null => {
        const id = typeof user?.id === 'string' ? user.id : null
        const email = typeof user?.email === 'string' ? user.email : null
        if (!id || !email) return null
        return {
          id,
          title: email,
          subtitle: user.organizationName ?? null,
        }
      })
      .filter((option): option is LookupSelectItem => option !== null)
    setUserOptions(options)
    return options
  }, [])

  const fields = React.useMemo<CrudField[]>(() => {
    const baseFields: CrudField[] = [
      {
        id: 'userId',
        label: translate('staff.teamMembers.form.fields.user', 'User'),
        type: 'custom',
        component: ({ value, setValue }) => (
          <LookupSelect
            value={typeof value === 'string' ? value : null}
            onChange={(next) => setValue(next)}
            options={userOptions}
            fetchOptions={fetchUserOptions}
            placeholder={translate('staff.teamMembers.form.fields.user.placeholder', 'Select a user')}
            searchPlaceholder={translate('staff.teamMembers.form.fields.user.search', 'Search users')}
            emptyLabel={translate('staff.teamMembers.form.fields.user.empty', 'No users found')}
            selectedHintLabel={(id) => translate('staff.teamMembers.form.fields.user.selected', 'Selected user: {{id}}', { id })}
          />
        ),
      },
      {
        id: 'teamId',
        label: '',
        type: 'custom',
        component: ({ value, setValue, setFormValue, values, disabled }) => {
          const currentValue = typeof value === 'string' ? value : ''
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {translate('staff.teamMembers.form.fields.team', 'Team')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(createTeamHref)}
                  disabled={disabled}
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  {translate('staff.teamMembers.form.actions.createTeam', 'Create new team')}
                </Button>
              </div>
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
                <option value="">{translate('ui.forms.select.emptyOption', '—')}</option>
                {teamOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )
        },
      },
      {
        id: 'displayName',
        label: translate('staff.teamMembers.form.fields.displayName', 'Display name'),
        type: 'text',
        required: true,
      },
      {
        id: 'description',
        label: translate('staff.teamMembers.form.fields.description', 'Description'),
        type: 'richtext',
        editor: 'uiw',
      },
      {
        id: 'roleIds',
        label: '',
        type: 'custom',
        component: ({ value, setValue, disabled }) => {
          const selectedValues = Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : []
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {translate('staff.teamMembers.form.fields.roles', 'Roles')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(createRoleHref)}
                  disabled={disabled}
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  {translate('staff.teamMembers.form.actions.defineRole', 'Define new role')}
                </Button>
              </div>
              <input
                className="w-full h-8 rounded border px-2 text-sm"
                placeholder={translate('ui.forms.listbox.searchPlaceholder', 'Search...')}
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
                    {translate('ui.forms.listbox.noMatches', 'No matches')}
                  </div>
                ) : null}
              </div>
            </div>
          )
        },
      },
      {
        id: 'isActive',
        label: translate('staff.teamMembers.form.fields.active', 'Active'),
        type: 'checkbox',
      },
    ]

    if (!tagsSection) {
      baseFields.splice(5, 0, {
        id: 'tags',
        label: translate('staff.teamMembers.form.fields.tags', 'Tags'),
        type: 'tags',
        placeholder: translate('staff.teamMembers.form.fields.tags.placeholder', 'Add tags'),
      })
    }

    return baseFields
  }, [
    createRoleHref,
    fetchUserOptions,
    filteredRoleOptions,
    roleSearch,
    roles,
    router,
    tagsSection,
    translate,
    teamOptions,
    userOptions,
  ])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const baseGroups: CrudFormGroup[] = [
      {
        id: 'details',
        column: 1,
        fields: ['userId', 'teamId', 'displayName', 'description', 'roleIds', 'isActive'],
      },
      {
        id: 'custom',
        title: translate('entities.customFields.title', 'Custom Attributes'),
        column: 2,
        kind: 'customFields',
      },
    ]

    if (tagsSection) {
      baseGroups.push({
        id: 'tags',
        column: 2,
        bare: true,
        component: () => (
          <TagsSection
            title={tagsSection.title}
            tags={tagsSection.tags}
            onChange={tagsSection.onChange}
            loadOptions={tagsSection.loadOptions}
            createTag={tagsSection.createTag}
            onSave={tagsSection.onSave}
            labels={tagsSection.labels}
          />
        ),
      })
    } else {
      baseGroups.splice(1, 0, {
        id: 'tags',
        title: translate('staff.teamMembers.form.fields.tags', 'Tags'),
        column: 2,
        fields: ['tags'],
      })
    }

    baseGroups.push({
      id: 'attachments',
      title: translate('attachments.library.title', 'Attachments'),
      column: 1,
      component: () => (
        <AttachmentsSection
          entityId={E.staff.staff_team_member}
          recordId={recordId}
          showHeader={false}
        />
      ),
    })

    return baseGroups
  }, [recordId, tagsSection, translate])

  return (
    <CrudForm<TeamMemberFormValues>
      title={title}
      backHref={backHref}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      fields={fields}
      groups={groups}
      entityId={E.staff.staff_team_member}
      initialValues={initialValues}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
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
