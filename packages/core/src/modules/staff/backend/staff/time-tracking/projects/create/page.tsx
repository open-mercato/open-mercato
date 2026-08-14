"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildProjectPayload,
  createProjectFormFields,
  createProjectFormGroups,
  createProjectFormSchema,
  type ProjectFormValues,
} from '../projectFormConfig'

const BACK_HREF = '/backend/staff/time-tracking/projects'

const INITIAL_VALUES: Partial<ProjectFormValues> = {
  status: 'active',
  billableByDefault: true,
  budgetEnabled: false,
  budgetKind: 'hours',
  budgetWarnAtPercent: '80',
  codeManual: false,
}

export default function TimeTrackingProjectCreatePage() {
  const t = useT()
  const router = useRouter()

  const formSchema = React.useMemo(() => createProjectFormSchema(), [])
  const fields = React.useMemo(() => createProjectFormFields(t), [t])
  const groups = React.useMemo(() => createProjectFormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ProjectFormValues>
          title={t('staff.time_tracking.projects.form.createTitle', 'New project')}
          backHref={BACK_HREF}
          cancelHref={BACK_HREF}
          fields={fields}
          groups={groups}
          schema={formSchema}
          initialValues={INITIAL_VALUES}
          entityIds={[E.staff.staff_time_project]}
          submitLabel={t('staff.timesheets.projects.form.actions.create', 'Create')}
          onSubmit={async (values) => {
            if (!values.name?.trim() || !values.code?.trim() || !values.customerId) {
              const fieldErrors: Record<string, string> = {}
              if (!values.name?.trim()) {
                fieldErrors.name = t('staff.time_tracking.projects.validation.nameRequired', 'A project name is required.')
              }
              if (!values.code?.trim()) {
                fieldErrors.code = t('staff.time_tracking.projects.validation.codeRequired', 'A project code is required.')
              }
              if (!values.customerId) {
                fieldErrors.customerId = t('staff.time_tracking.projects.validation.customerRequired', 'A customer is required.')
              }
              throw createCrudFormError(
                t('staff.time_tracking.projects.errors.required', 'Fill in the required fields.'),
                fieldErrors,
              )
            }

            const payload = buildProjectPayload(values)

            const { result: created } = await createCrud<{ id?: string }>(
              'staff/timesheets/time-projects',
              payload,
              { errorMessage: t('staff.timesheets.projects.errors.save', 'Failed to save project.') },
            )

            const newId = created?.id

            // Auto-assign creator to the project
            if (newId) {
              try {
                const selfRes = await apiCall<{ member?: { id?: string } | null }>('/api/staff/team-members/self')
                const staffMemberId = selfRes.result?.member?.id
                if (staffMemberId) {
                  await createCrud('staff/timesheets/time-projects/' + newId + '/employees', {
                    staffMemberId,
                    assignedStartDate: new Date().toISOString().slice(0, 10),
                    status: 'active',
                  }, { errorMessage: '' })
                }
              } catch {
                // non-critical — project created, self-assignment is best-effort
              }
            }

            flash(t('staff.timesheets.projects.messages.saved', 'Project saved.'), 'success')
            if (newId) router.push(`/backend/staff/time-tracking/projects/${newId}`)
            else router.push(BACK_HREF)
          }}
        />
      </PageBody>
    </Page>
  )
}
