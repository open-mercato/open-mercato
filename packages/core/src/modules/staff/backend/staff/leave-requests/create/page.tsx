"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { LeaveRequestForm, buildLeaveRequestPayload, type LeaveRequestFormValues } from '@open-mercato/core/modules/staff/components/LeaveRequestForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function StaffLeaveRequestCreatePage() {
  const t = useT()
  const router = useRouter()

  const initialValues = React.useMemo<LeaveRequestFormValues>(() => ({
    startDate: null,
    endDate: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }), [])

  const handleSubmit = React.useCallback(async (values: LeaveRequestFormValues) => {
    const payload = buildLeaveRequestPayload(values)
    const { result } = await createCrud<{ id?: string }>('staff/leave-requests', payload, {
      errorMessage: t('staff.leaveRequests.form.errors.create', 'Failed to create leave request.'),
    })
    const requestId = typeof result?.id === 'string' ? result.id : null
    if (requestId) {
      router.push(`/backend/staff/leave-requests/${encodeURIComponent(requestId)}`)
      return
    }
    router.push('/backend/staff/leave-requests')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <LeaveRequestForm
          title={t('staff.leaveRequests.form.createTitle', 'Create leave request')}
          submitLabel={t('staff.leaveRequests.form.actions.create', 'Create')}
          backHref="/backend/staff/leave-requests"
          cancelHref="/backend/staff/leave-requests"
          initialValues={initialValues}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
