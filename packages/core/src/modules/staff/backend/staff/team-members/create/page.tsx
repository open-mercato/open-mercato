"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { TeamMemberForm, buildTeamMemberPayload, type TeamMemberFormValues } from '@open-mercato/core/modules/staff/components/TeamMemberForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function StaffTeamMemberCreatePage() {
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
    const { result } = await createCrud<{ id?: string }>('staff/team-members', payload, {
      errorMessage: translate('staff.teamMembers.form.errors.create', 'Failed to create team member.'),
    })
    const memberId = typeof result?.id === 'string' ? result.id : null
    if (memberId) {
      router.push(`/backend/staff/team-members/${encodeURIComponent(memberId)}?tab=availability&created=1`)
      return
    }
    router.push('/backend/staff/team-members')
  }, [router, translate])

  return (
    <Page>
      <PageBody>
        <TeamMemberForm
          title={translate('staff.teamMembers.form.createTitle', 'Add team member')}
          backHref="/backend/staff/team-members"
          cancelHref="/backend/staff/team-members"
          submitLabel={translate('staff.teamMembers.form.actions.create', 'Create')}
          initialValues={initialValues}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
