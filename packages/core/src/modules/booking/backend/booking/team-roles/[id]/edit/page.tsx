"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { TeamRoleForm, type TeamRoleFormValues, type TeamRoleOption, buildTeamRolePayload } from '@open-mercato/core/modules/booking/components/TeamRoleForm'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

type TeamRoleRecord = {
  id: string
  name: string
  description?: string | null
  teamId?: string | null
  team_id?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
  appearance_icon?: string | null
  appearance_color?: string | null
} & Record<string, unknown>

type TeamRoleResponse = {
  items?: TeamRoleRecord[]
}

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

export default function BookingTeamRoleEditPage({ params }: { params?: { id?: string } }) {
  const roleId = params?.id
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [initialValues, setInitialValues] = React.useState<TeamRoleFormValues | null>(null)
  const [teams, setTeams] = React.useState<TeamRoleOption[]>([])

  React.useEffect(() => {
    if (!roleId) return
    const roleIdValue = roleId
    let cancelled = false
    async function loadRole() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: roleIdValue })
        const payload = await readApiResultOrThrow<TeamRoleResponse>(
          `/api/booking/team-roles?${params.toString()}`,
          undefined,
          { errorMessage: t('booking.teamRoles.errors.load', 'Failed to load team role.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('booking.teamRoles.errors.notFound', 'Team role not found.'))
        const customFields = extractCustomFieldEntries(record)
        const appearanceIcon = typeof record.appearanceIcon === 'string'
          ? record.appearanceIcon
          : typeof record.appearance_icon === 'string'
            ? record.appearance_icon
            : null
        const appearanceColor = typeof record.appearanceColor === 'string'
          ? record.appearanceColor
          : typeof record.appearance_color === 'string'
            ? record.appearance_color
            : null
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            teamId: typeof record.teamId === 'string'
              ? record.teamId
              : typeof record.team_id === 'string'
                ? record.team_id
                : null,
            name: record.name ?? '',
            description: record.description ?? '',
            appearance: { icon: appearanceIcon, color: appearanceColor },
            ...customFields,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.teamRoles.errors.load', 'Failed to load team role.')
        flash(message, 'error')
      }
    }
    loadRole()
    return () => { cancelled = true }
  }, [roleId, t])

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
            return { id, name }
          })
          .filter((entry): entry is TeamRoleOption => entry !== null)
        if (!cancelled) setTeams(options)
      } catch {
        if (!cancelled) setTeams([])
      }
    }
    loadTeams()
    return () => { cancelled = true }
  }, [scopeVersion])

  const handleSubmit = React.useCallback(async (values: TeamRoleFormValues) => {
    if (!roleId) return
    const payload = buildTeamRolePayload(values, { id: roleId })
    await updateCrud('booking/team-roles', payload, {
      errorMessage: t('booking.teamRoles.errors.save', 'Failed to save team role.'),
    })
    flash(t('booking.teamRoles.messages.saved', 'Team role saved.'), 'success')
    router.push('/backend/booking/team-roles')
  }, [roleId, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!roleId) return
    await deleteCrud('booking/team-roles', roleId, {
      errorMessage: t('booking.teamRoles.errors.delete', 'Failed to delete team role.'),
    })
    flash(t('booking.teamRoles.messages.deleted', 'Team role deleted.'), 'success')
    router.push('/backend/booking/team-roles')
  }, [roleId, router, t])

  return (
    <Page>
      <PageBody>
        <TeamRoleForm
          title={t('booking.teamRoles.form.editTitle', 'Edit team role')}
          backHref="/backend/booking/team-roles"
          cancelHref="/backend/booking/team-roles"
          initialValues={initialValues ?? { name: '', description: '', appearance: { icon: null, color: null }, teamId: null }}
          teamOptions={teams}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          isLoading={!initialValues}
          loadingMessage={t('booking.teamRoles.form.loading', 'Loading team role...')}
        />
      </PageBody>
    </Page>
  )
}
