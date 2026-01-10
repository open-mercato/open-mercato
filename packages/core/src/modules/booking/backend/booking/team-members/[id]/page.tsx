"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/booking/backend/components/AvailabilityRulesEditor'
import { buildMemberScheduleItems } from '@open-mercato/core/modules/booking/lib/memberSchedule'

const DEFAULT_PAGE_SIZE = 100

type TeamMemberRecord = {
  id: string
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
}

type TeamRolesResponse = {
  items?: TeamRoleRow[]
}

type UsersResponse = {
  items?: Array<{ id?: string; email?: string; organizationName?: string | null }>
}

const extractCustomFieldsFromRecord = (record: Record<string, unknown>): Record<string, unknown> => {
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('cf_')) customFields[key] = value
  }
  const customValues = (record as any).customValues
  if (customValues && typeof customValues === 'object' && !Array.isArray(customValues)) {
    for (const [key, value] of Object.entries(customValues as Record<string, unknown>)) {
      if (!key) continue
      customFields[`cf_${key}`] = value
    }
  }
  const customEntries = (record as any).customFields
  if (Array.isArray(customEntries)) {
    customEntries.forEach((entry) => {
      const key = entry && typeof entry.key === 'string' ? entry.key : null
      if (!key) return
      customFields[`cf_${key}`] = (entry as any).value
    })
  } else if (customEntries && typeof customEntries === 'object') {
    for (const [key, value] of Object.entries(customEntries as Record<string, unknown>)) {
      if (!key) continue
      customFields[`cf_${key}`] = value
    }
  }
  return customFields
}

export default function BookingTeamMemberDetailPage({ params }: { params?: { id?: string } }) {
  const memberId = params?.id
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [roles, setRoles] = React.useState<TeamRoleRow[]>([])
  const [userOptions, setUserOptions] = React.useState<LookupSelectItem[]>([])
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [availabilityRuleSetId, setAvailabilityRuleSetId] = React.useState<string | null>(null)

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
        const customFields = extractCustomFieldsFromRecord(record)
        if (!cancelled) {
          const user = record.user && typeof record.user === 'object'
            ? record.user as { id?: string; email?: string | null }
            : null
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
            userId: record.userId ?? record.user_id ?? null,
            displayName: record.displayName ?? record.display_name ?? '',
            description: record.description ?? '',
            roleIds: Array.isArray(record.roleIds) ? record.roleIds : [],
            tags: Array.isArray(record.tags) ? record.tags : [],
            isActive: record.isActive ?? true,
            ...customFields,
          })
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
    let cancelled = false
    async function loadRoles() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: String(DEFAULT_PAGE_SIZE) })
        const call = await apiCall<TeamRolesResponse>(`/api/booking/team-roles?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (!cancelled) setRoles(items)
      } catch {
        if (!cancelled) setRoles([])
      }
    }
    loadRoles()
    return () => { cancelled = true }
  }, [scopeVersion])

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
      type: 'select',
      multiple: true,
      listbox: true,
      options: roles.map((role) => ({ value: role.id, label: role.name })),
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
  ], [fetchUserOptions, roles, t, userOptions])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!memberId) return
    const customFields = collectCustomFieldValues(values)
    const payload: Record<string, unknown> = {
      id: memberId,
      userId: values.userId ? String(values.userId) : null,
      displayName: values.displayName ? String(values.displayName) : '',
      description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
      roleIds: Array.isArray(values.roleIds) ? values.roleIds : [],
      tags: Array.isArray(values.tags) ? values.tags : [],
      isActive: values.isActive ?? true,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    await updateCrud('booking/team-members', payload, {
      errorMessage: t('booking.teamMembers.form.errors.update', 'Failed to update team member.'),
    })
    flash(t('booking.teamMembers.form.flash.updated', 'Team member updated.'), 'success')
  }, [memberId, t])

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
