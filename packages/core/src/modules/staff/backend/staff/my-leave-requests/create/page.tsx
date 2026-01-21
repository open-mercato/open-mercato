"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LeaveRequestForm, buildLeaveRequestPayload, type LeaveRequestFormValues } from '@open-mercato/core/modules/staff/components/LeaveRequestForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SelfMemberResponse = {
  member?: {
    id?: string
    displayName?: string
  } | null
}

export default function StaffMyLeaveRequestCreatePage() {
  const t = useT()
  const router = useRouter()
  const [member, setMember] = React.useState<{ id: string; displayName: string } | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<SelfMemberResponse>(
          '/api/staff/team-members/self',
          undefined,
          { errorMessage: t('staff.leaveRequests.errors.profileLoad', 'Failed to load your profile.') },
        )
        const entry = payload.member
        if (!entry?.id || !entry.displayName) {
          if (!cancelled) setMember(null)
          return
        }
        if (!cancelled) setMember({ id: entry.id, displayName: entry.displayName })
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('staff.leaveRequests.errors.profileLoad', 'Failed to load your profile.')
          setError(message)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [t])

  const handleSubmit = React.useCallback(async (values: LeaveRequestFormValues) => {
    if (!member?.id) return
    const payload = buildLeaveRequestPayload({ ...values, memberId: member.id })
    const { result } = await createCrud<{ id?: string }>('staff/leave-requests', payload, {
      errorMessage: t('staff.leaveRequests.form.errors.create', 'Failed to create leave request.'),
    })
    const requestId = typeof result?.id === 'string' ? result.id : null
    if (requestId) {
      router.push(`/backend/staff/my-leave-requests/${encodeURIComponent(requestId)}`)
      return
    }
    router.push('/backend/staff/my-leave-requests')
  }, [member?.id, router, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage message={t('staff.leaveRequests.form.loading', 'Loading leave request...')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage message={error} />
        </PageBody>
      </Page>
    )
  }

  if (!member) {
    return (
      <Page>
        <PageBody>
          <div className="space-y-3 rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            <p>{t('staff.leaveRequests.empty.profileRequired', 'Create your team member profile to submit leave requests.')}</p>
            <Button asChild size="sm">
              <Link href="/backend/staff/profile/create">
                {t('staff.leaveRequests.actions.createProfile', 'Create my profile')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const initialValues: LeaveRequestFormValues = {
    memberId: member.id,
    memberLabel: member.displayName,
    startDate: null,
    endDate: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }

  return (
    <Page>
      <PageBody>
        <LeaveRequestForm
          title={t('staff.leaveRequests.form.createTitle', 'Create leave request')}
          submitLabel={t('staff.leaveRequests.form.actions.create', 'Create')}
          backHref="/backend/staff/my-leave-requests"
          cancelHref="/backend/staff/my-leave-requests"
          initialValues={initialValues}
          onSubmit={handleSubmit}
          allowMemberSelect={false}
          memberLabel={member.displayName}
        />
      </PageBody>
    </Page>
  )
}
