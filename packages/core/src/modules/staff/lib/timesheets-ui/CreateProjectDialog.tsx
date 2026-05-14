"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import {
  buildProjectPayload,
  createProjectFormFields,
  createProjectFormGroups,
  createProjectFormSchema,
  type ProjectFormValues,
} from '../../backend/staff/timesheets/projects/projectFormConfig'

type CreateProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onProjectCreated: (project: { id: string; name: string; code: string | null }) => void
}

export function CreateProjectDialog({ open, onOpenChange, onProjectCreated }: CreateProjectDialogProps) {
  const t = useT()

  const formSchema = React.useMemo(() => createProjectFormSchema(), [])
  const fields = React.useMemo(() => createProjectFormFields(t), [t])
  const groups = React.useMemo(() => createProjectFormGroups(t), [t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('staff.timesheets.projects.form.createTitle', 'Create project')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<ProjectFormValues>
          embedded
          fields={fields}
          groups={groups}
          schema={formSchema}
          initialValues={{}}
          entityIds={[E.staff.staff_time_project]}
          submitLabel={t('staff.timesheets.projects.form.actions.create', 'Create')}
          extraActions={(
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('staff.timesheets.projects.form.actions.cancel', 'Cancel')}
            </Button>
          )}
          onSubmit={async (values) => {
            const payload = buildProjectPayload(values)

            const { result: created } = await createCrud<{ id?: string; name?: string; code?: string | null }>(
              'staff/timesheets/time-projects',
              payload,
              { errorMessage: t('staff.timesheets.projects.errors.save', 'Failed to save project.') },
            )

            const newId = created?.id
            if (!newId) {
              throw createCrudFormError(
                t('staff.timesheets.projects.errors.save', 'Failed to save project.'),
              )
            }

            // Auto-assign creator to the project (best-effort)
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

            onProjectCreated({
              id: newId,
              name: created?.name ?? values.name.trim(),
              code: created?.code ?? values.code?.trim() ?? null,
            })

            flash(t('staff.timesheets.projects.messages.saved', 'Project saved.'), 'success')
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
