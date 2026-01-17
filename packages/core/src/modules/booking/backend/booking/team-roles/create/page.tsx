"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TeamRoleForm, type TeamRoleFormValues, type TeamRoleOption, buildTeamRolePayload } from '@open-mercato/core/modules/booking/components/TeamRoleForm'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

export default function BookingTeamRoleCreatePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const [teams, setTeams] = React.useState<TeamRoleOption[]>([])
  const initialTeamId = searchParams?.get('teamId')?.trim() || null

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
    const payload = buildTeamRolePayload(values)
    await createCrud('booking/team-roles', payload, {
      errorMessage: t('booking.teamRoles.errors.save', 'Failed to save team role.'),
    })
    flash(t('booking.teamRoles.messages.saved', 'Team role saved.'), 'success')
    router.push('/backend/booking/team-roles')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <TeamRoleForm
          title={t('booking.teamRoles.form.createTitle', 'Add team role')}
          backHref="/backend/booking/team-roles"
          cancelHref="/backend/booking/team-roles"
          submitLabel={t('booking.teamRoles.form.actions.create', 'Create')}
          initialValues={{ name: '', description: '', appearance: { icon: null, color: null }, teamId: initialTeamId }}
          teamOptions={teams}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
