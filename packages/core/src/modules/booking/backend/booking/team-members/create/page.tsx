"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

const DEFAULT_PAGE_SIZE = 100

type TeamRoleRow = {
  id: string
  name: string
}

type TeamRolesResponse = {
  items?: TeamRoleRow[]
}

type UserRow = {
  id: string
  email: string
  organizationName?: string | null
}

type UsersResponse = {
  items?: UserRow[]
}

export default function BookingTeamMemberCreatePage() {
  const t = useT()
  const router = useRouter()
  const [roles, setRoles] = React.useState<TeamRoleRow[]>([])
  const [userOptions, setUserOptions] = React.useState<LookupSelectItem[]>([])
  const scopeVersion = useOrganizationScopeVersion()

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
    const customFields = collectCustomFieldValues(values)
    const payload: Record<string, unknown> = {
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
    flash(t('booking.teamMembers.form.flash.created', 'Team member created.'), 'success')
    router.push(memberId ? `/backend/booking/team-members/${encodeURIComponent(memberId)}` : '/backend/booking/team-members')
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
          initialValues={{ isActive: true, roleIds: [], tags: [] }}
          entityId={E.booking.booking_team_member}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
