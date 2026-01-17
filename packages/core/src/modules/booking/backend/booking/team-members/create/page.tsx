"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { TeamMemberForm, buildTeamMemberPayload, type TeamMemberFormValues } from '@open-mercato/core/modules/booking/components/TeamMemberForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function BookingTeamMemberCreatePage() {
  const translate = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTeamId = searchParams?.get('teamId')?.trim() || null
  const initialValues = React.useMemo<TeamMemberFormValues>(() => ({
    isActive: true,
    roleIds: [],
    tags: [],
    teamId: initialTeamId,
  }), [initialTeamId])

  const handleSubmit = React.useCallback(async (values: TeamMemberFormValues) => {
    const payload = buildTeamMemberPayload(values)
    const { result } = await createCrud<{ id?: string }>('booking/team-members', payload, {
      errorMessage: translate('booking.teamMembers.form.errors.create', 'Failed to create team member.'),
    })
    const memberId = typeof result?.id === 'string' ? result.id : null
    if (memberId) {
      router.push(`/backend/booking/team-members/${encodeURIComponent(memberId)}?tab=availability&created=1`)
      return
    }
    router.push('/backend/booking/team-members')
  }, [router, translate])

  return (
    <Page>
      <PageBody>
        <TeamMemberForm
          title={translate('booking.teamMembers.form.createTitle', 'Add team member')}
          backHref="/backend/booking/team-members"
          cancelHref="/backend/booking/team-members"
          submitLabel={translate('booking.teamMembers.form.actions.create', 'Create')}
          initialValues={initialValues}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
