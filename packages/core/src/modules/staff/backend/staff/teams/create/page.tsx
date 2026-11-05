"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TeamForm, type TeamFormValues, buildTeamPayload } from '@open-mercato/core/modules/staff/components/TeamForm'

export default function StaffTeamCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: TeamFormValues) => {
    const payload = buildTeamPayload(values)
    await createCrud('staff/teams', payload, {
      errorMessage: t('staff.teams.errors.save', 'Failed to save team.'),
    })
    flash(t('staff.teams.messages.saved', 'Team saved.'), 'success')
    router.push('/backend/staff/teams')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <TeamForm
          title={t('staff.teams.form.createTitle', 'Add team')}
          backHref="/backend/staff/teams"
          cancelHref="/backend/staff/teams"
          submitLabel={t('staff.teams.form.actions.create', 'Create')}
          initialValues={{ name: '', description: '', isActive: true }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
