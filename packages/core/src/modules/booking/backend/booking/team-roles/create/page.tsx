"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { TeamRoleForm, type TeamRoleFormValues, buildTeamRolePayload } from '../TeamRoleForm'

export default function BookingTeamRoleCreatePage() {
  const t = useT()
  const router = useRouter()

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
          initialValues={{ name: '', description: '', appearance: { icon: null, color: null } }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
