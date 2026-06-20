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

const BACK_HREF = '/backend/staff/timesheets/projects'

export default function TimesheetProjectCreatePage() {
  const t = useT()
  const router = useRouter()

  const formSchema = React.useMemo(() => createProjectFormSchema(), [])
  const fields = React.useMemo(() => createProjectFormFields(t), [t])
  const groups = React.useMemo(() => createProjectFormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ProjectFormValues>
          title={t('staff.timesheets.projects.form.createTitle', 'Create project')}
          backHref={BACK_HREF}
          cancelHref={BACK_HREF}
          fields={fields}
          groups={groups}
          schema={formSchema}
          initialValues={{}}
          entityIds={[E.staff.staff_time_project]}
          submitLabel={t('staff.timesheets.projects.form.actions.create', 'Create')}
          onSubmit={async (values) => {
            if (!values.name?.trim() || !values.code?.trim()) {
              const fieldErrors: Record<string, string> = {}
              if (!values.name?.trim()) fieldErrors.name = 'Required'
              if (!values.code?.trim()) fieldErrors.code = 'Required'
              throw createCrudFormError(
                t('staff.timesheets.projects.errors.required', 'Name and code are required.'),
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
            if (newId) router.push(`/backend/staff/timesheets/projects/${newId}`)
            else router.push(BACK_HREF)
          }}
        />
      </PageBody>
    </Page>
  )
}
