"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { TagsSection, type TagOption } from '@open-mercato/ui/backend/detail'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/booking/components/AvailabilityRulesEditor'
import { buildMemberScheduleItems } from '@open-mercato/core/modules/booking/lib/memberSchedule'
import { Plus } from 'lucide-react'

const DEFAULT_PAGE_SIZE = 100

type TeamMemberRecord = {
  id: string
  teamId?: string | null
  team_id?: string | null
  displayName: string
  description?: string | null
  userId?: string | null
  roleIds?: string[]
  tags?: string[]
  isActive?: boolean
  availabilityRuleSetId?: string | null
  user?: { id?: string; email?: string | null } | null
  customFields?: Record<string, unknown> | null
} & Record<string, unknown>

type TeamMemberResponse = {
  items?: TeamMemberRecord[]
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

export default function BookingTeamMemberDetailPage({ params }: { params?: { id?: string } }) {
  const memberId = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [roles, setRoles] = React.useState<TeamRoleRow[]>([])
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null)
  const [userOptions, setUserOptions] = React.useState<LookupSelectItem[]>([])
  const [teamOptions, setTeamOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [availabilityRuleSetId, setAvailabilityRuleSetId] = React.useState<string | null>(null)
  const flashShownRef = React.useRef(false)
  const [roleSearch, setRoleSearch] = React.useState('')
  const [tags, setTags] = React.useState<TagOption[]>([])

  React.useEffect(() => {
    if (!memberId) return
    let cancelled = false
    async function loadMember() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: memberId })
        const payload = await readApiResultOrThrow<TeamMemberResponse>(
          `/api/booking/team-members?${params.toString()}`,
          undefined,
          { errorMessage: t('booking.teamMembers.form.errors.load', 'Failed to load team member.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('booking.teamMembers.form.errors.notFound', 'Team member not found.'))
        const customFields = extractCustomFieldEntries(record)
        if (!cancelled) {
          const user = record.user && typeof record.user === 'object'
            ? record.user as { id?: string; email?: string | null }
            : null
          const resolvedTeamId = record.teamId ?? record.team_id ?? null
          if (user?.id && user?.email) {
            setUserOptions([{ id: user.id, title: user.email, subtitle: null }])
          } else if (record.userId || record.user_id) {
            const targetId = typeof record.userId === 'string' ? record.userId : typeof record.user_id === 'string' ? record.user_id : null
            if (targetId) {
              apiCall<UsersResponse>(`/api/auth/users?id=${encodeURIComponent(targetId)}`)
                .then((call) => {
                  const entry = Array.isArray(call.result?.items) ? call.result.items[0] : null
                  if (entry?.id && entry?.email) {
                    setUserOptions([{ id: entry.id, title: entry.email, subtitle: entry.organizationName ?? null }])
                  }
                })
                .catch(() => undefined)
            }
          }
          setInitialValues({
            id: record.id,
            teamId: resolvedTeamId,
            userId: record.userId ?? record.user_id ?? null,
            displayName: record.displayName ?? record.display_name ?? '',
            description: record.description ?? '',
            roleIds: Array.isArray(record.roleIds)
              ? record.roleIds
              : Array.isArray(record.role_ids)
                ? record.role_ids
                : [],
            isActive: record.isActive ?? true,
            ...customFields,
          })
          const tagLabels = Array.isArray(record.tags)
            ? record.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
            : []
          setTags(tagLabels.map((tag) => ({ id: tag, label: tag })))
          setSelectedTeamId(resolvedTeamId)
          setAvailabilityRuleSetId(
            typeof record.availabilityRuleSetId === 'string'
              ? record.availabilityRuleSetId
              : typeof record.availability_rule_set_id === 'string'
                ? record.availability_rule_set_id
                : null,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.teamMembers.form.errors.load', 'Failed to load team member.')
        flash(message, 'error')
      }
    }
    loadMember()
    return () => { cancelled = true }
  }, [memberId, t])

  React.useEffect(() => {
    if (!searchParams) return
    const tabParam = searchParams.get('tab')
    if (tabParam === 'availability') {
      setActiveTab('availability')
    }
    const created = searchParams.get('created') === '1'
    if (created && !flashShownRef.current) {
      flashShownRef.current = true
      flash(t('booking.teamMembers.flash.createdAvailability', 'Saved. You can now set availability.'), 'success')
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('created')
      const nextQuery = nextParams.toString()
      const nextPath = memberId
        ? `/backend/booking/team-members/${encodeURIComponent(memberId)}${nextQuery ? `?${nextQuery}` : ''}`
        : `/backend/booking/team-members${nextQuery ? `?${nextQuery}` : ''}`
      router.replace(nextPath)
    }
  }, [memberId, router, searchParams, t])

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

  const tagLabels = React.useMemo(
    () => ({
      loading: t('booking.teamMembers.tags.loading', 'Loading tags...'),
      placeholder: t('booking.teamMembers.tags.placeholder', 'Type to add tags'),
      empty: t('booking.teamMembers.tags.empty', 'No tags yet. Add labels to organize team members.'),
      loadError: t('booking.teamMembers.tags.loadError', 'Failed to load tags.'),
      createError: t('booking.teamMembers.tags.createError', 'Failed to create tag.'),
      updateError: t('booking.teamMembers.tags.updateError', 'Failed to update tags.'),
      labelRequired: t('booking.teamMembers.tags.labelRequired', 'Tag name is required.'),
      saveShortcut: t('booking.teamMembers.tags.saveShortcut', 'Save Cmd+Enter / Ctrl+Enter'),
      cancelShortcut: t('booking.teamMembers.tags.cancelShortcut', 'Cancel (Esc)'),
      edit: t('ui.forms.actions.edit', 'Edit'),
      cancel: t('ui.forms.actions.cancel', 'Cancel'),
      success: t('booking.teamMembers.tags.success', 'Tags updated.'),
    }),
    [t],
  )

  const loadTagOptions = React.useCallback(async (query?: string): Promise<TagOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '100' })
    const call = await apiCall<TeamMemberResponse>(`/api/booking/team-members?${params.toString()}`)
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const seen = new Set<string>()
    const options: TagOption[] = []
    items.forEach((item) => {
      const itemTags = Array.isArray(item.tags) ? item.tags : []
      itemTags.forEach((tag) => {
        if (typeof tag !== 'string') return
        const normalized = tag.trim()
        if (!normalized.length) return
        const key = normalized.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        options.push({ id: normalized, label: normalized })
      })
    })
    if (query && query.trim().length) {
      const needle = query.trim().toLowerCase()
      return options.filter((option) => option.label.toLowerCase().includes(needle))
    }
    return options
  }, [])

  const createTag = React.useCallback(async (label: string): Promise<TagOption> => {
    const normalized = label.trim()
    if (!normalized.length) {
      throw new Error(t('booking.teamMembers.tags.labelRequired', 'Tag name is required.'))
    }
    return { id: normalized, label: normalized }
  }, [t])

  const handleTagsSave = React.useCallback(
    async ({ next }: { next: TagOption[]; added: TagOption[]; removed: TagOption[] }) => {
      if (!memberId) return
      const nextLabels = Array.from(
        new Set(next.map((tag) => tag.label.trim()).filter((tag) => tag.length > 0)),
      )
      await updateCrud('booking/team-members', { id: memberId, tags: nextLabels }, {
        errorMessage: t('booking.teamMembers.tags.updateError', 'Failed to update tags.'),
      })
      setTags(nextLabels.map((tag) => ({ id: tag, label: tag })))
      flash(t('booking.teamMembers.tags.success', 'Tags updated.'), 'success')
    },
    [memberId, t],
  )

  const tagsSection = React.useMemo(
    () => ({
      title: t('booking.teamMembers.tags.title', 'Tags'),
      tags,
      onChange: setTags,
      loadOptions: loadTagOptions,
      createTag,
      onSave: handleTagsSave,
      labels: tagLabels,
    }),
    [createTag, handleTagsSave, loadTagOptions, t, tagLabels, tags],
  )

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
      id: 'isActive',
      label: t('booking.teamMembers.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [createRoleHref, fetchUserOptions, filteredRoleOptions, roleSearch, roles, router, t, teamOptions, userOptions])

  const groups = React.useMemo<CrudFormGroup[]>(() => ([
    {
      id: 'details',
      column: 1,
      fields: ['userId', 'teamId', 'displayName', 'description', 'roleIds', 'isActive'],
    },
    {
      id: 'custom',
      title: t('entities.customFields.title', 'Custom Attributes'),
      column: 2,
      kind: 'customFields',
    },
    {
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
    },
  ]), [t, tagsSection])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!memberId) return
    const customFields = collectCustomFieldValues(values)
    const payload: Record<string, unknown> = {
      id: memberId,
      teamId: values.teamId ? String(values.teamId) : null,
      userId: values.userId ? String(values.userId) : null,
      displayName: values.displayName ? String(values.displayName) : '',
      description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
      roleIds: Array.isArray(values.roleIds) ? values.roleIds : [],
      isActive: values.isActive ?? true,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    await updateCrud('booking/team-members', payload, {
      errorMessage: t('booking.teamMembers.form.errors.update', 'Failed to update team member.'),
    })
    flash(t('booking.teamMembers.form.flash.updated', 'Team member updated.'), 'success')
    router.push('/backend/booking/team-members')
  }, [memberId, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!memberId) return
    await deleteCrud('booking/team-members', memberId, {
      errorMessage: t('booking.teamMembers.form.errors.delete', 'Failed to delete team member.'),
    })
    flash(t('booking.teamMembers.form.flash.deleted', 'Team member deleted.'), 'success')
    router.push('/backend/booking/team-members')
  }, [memberId, router, t])

  const handleRulesetChange = React.useCallback(async (nextId: string | null) => {
    if (!memberId) return
    await updateCrud('booking/team-members', { id: memberId, availabilityRuleSetId: nextId }, {
      errorMessage: t('booking.teamMembers.availability.ruleset.updateError', 'Failed to update schedule.'),
    })
    setAvailabilityRuleSetId(nextId)
    flash(t('booking.teamMembers.availability.ruleset.updateSuccess', 'Schedule updated.'), 'success')
  }, [memberId, t])

  const tabs = React.useMemo(() => ([
    { id: 'details', label: t('booking.teamMembers.tabs.details', 'Details') },
    { id: 'availability', label: t('booking.teamMembers.tabs.availability', 'Availability') },
  ]), [t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={t('booking.teamMembers.tabs.label', 'Team member sections')}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id as 'details' | 'availability')}
                  className={`relative -mb-px border-b-2 px-0 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activeTab === 'details' ? (
            <CrudForm
              title={t('booking.teamMembers.form.editTitle', 'Edit team member')}
              backHref="/backend/booking/team-members"
              cancelHref="/backend/booking/team-members"
              fields={fields}
              groups={groups}
              initialValues={initialValues ?? undefined}
              entityId={E.booking.booking_team_member}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              isLoading={!initialValues}
              loadingMessage={t('booking.teamMembers.form.loading', 'Loading team member...')}
            />
          ) : (
            <AvailabilityRulesEditor
              subjectType="member"
              subjectId={memberId ?? ''}
              labelPrefix="booking.teamMembers"
              mode="availability"
              rulesetId={availabilityRuleSetId}
              onRulesetChange={handleRulesetChange}
              buildScheduleItems={({ availabilityRules, bookedEvents, translate }) => (
                buildMemberScheduleItems({ availabilityRules, bookedEvents, translate })
              )}
            />
          )}
        </div>
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
