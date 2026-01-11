"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { TeamForm, type TeamFormValues, buildTeamPayload } from '@open-mercato/core/modules/booking/components/TeamForm'

export default function BookingTeamCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: TeamFormValues) => {
    const payload = buildTeamPayload(values)
    await createCrud('booking/teams', payload, {
      errorMessage: t('booking.teams.errors.save', 'Failed to save team.'),
    })
    flash(t('booking.teams.messages.saved', 'Team saved.'), 'success')
    router.push('/backend/booking/teams')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <TeamForm
          title={t('booking.teams.form.createTitle', 'Add team')}
          backHref="/backend/booking/teams"
          cancelHref="/backend/booking/teams"
          submitLabel={t('booking.teams.form.actions.create', 'Create')}
          initialValues={{ name: '', description: '', isActive: true }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
