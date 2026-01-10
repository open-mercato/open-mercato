"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { TeamForm, type TeamFormValues, buildTeamPayload } from '../../TeamForm'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'

type TeamRecord = {
  id: string
  name: string
  description?: string | null
  isActive?: boolean
  is_active?: boolean
} & Record<string, unknown>

type TeamResponse = {
  items?: TeamRecord[]
}

export default function BookingTeamEditPage({ params }: { params?: { id?: string } }) {
  const teamId = params?.id
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<TeamFormValues | null>(null)

  React.useEffect(() => {
    if (!teamId) return
    let cancelled = false
    async function loadTeam() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: teamId })
        const payload = await readApiResultOrThrow<TeamResponse>(
          `/api/booking/teams?${params.toString()}`,
          undefined,
          { errorMessage: t('booking.teams.errors.load', 'Failed to load team.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('booking.teams.errors.notFound', 'Team not found.'))
        const customFields = extractCustomFieldEntries(record)
        const isActive = typeof record.isActive === 'boolean'
          ? record.isActive
          : typeof record.is_active === 'boolean'
            ? record.is_active
            : true
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            name: record.name ?? '',
            description: record.description ?? '',
            isActive,
            ...customFields,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.teams.errors.load', 'Failed to load team.')
        flash(message, 'error')
      }
    }
    loadTeam()
    return () => { cancelled = true }
  }, [teamId, t])

  const handleSubmit = React.useCallback(async (values: TeamFormValues) => {
    if (!teamId) return
    const payload = buildTeamPayload(values, { id: teamId })
    await updateCrud('booking/teams', payload, {
      errorMessage: t('booking.teams.errors.save', 'Failed to save team.'),
    })
    flash(t('booking.teams.messages.saved', 'Team saved.'), 'success')
  }, [teamId, t])

  const handleDelete = React.useCallback(async () => {
    if (!teamId) return
    await deleteCrud('booking/teams', teamId, {
      errorMessage: t('booking.teams.errors.delete', 'Failed to delete team.'),
    })
    flash(t('booking.teams.messages.deleted', 'Team deleted.'), 'success')
    router.push('/backend/booking/teams')
  }, [teamId, router, t])

  return (
    <Page>
      <PageBody>
        <TeamForm
          title={t('booking.teams.form.editTitle', 'Edit team')}
          backHref="/backend/booking/teams"
          cancelHref="/backend/booking/teams"
          initialValues={initialValues ?? { name: '', description: '', isActive: true }}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          isLoading={!initialValues}
          loadingMessage={t('booking.teams.form.loading', 'Loading team...')}
        />
      </PageBody>
    </Page>
  )
}
