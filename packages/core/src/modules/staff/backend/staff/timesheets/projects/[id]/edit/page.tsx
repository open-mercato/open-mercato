"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  buildProjectPayload,
  createProjectFormFields,
  createProjectFormGroups,
  createProjectFormSchema,
  type ProjectFormValues,
} from '../../projectFormConfig'

const LIST_HREF = '/backend/staff/timesheets/projects'

export default function TimesheetProjectEditPage({ params }: { params?: { id?: string } }) {
  const projectId = params?.id
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [initialValues, setInitialValues] = React.useState<ProjectFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const formSchema = React.useMemo(() => createProjectFormSchema(), [])
  const fields = React.useMemo(() => createProjectFormFields(t), [t])
  const groups = React.useMemo(() => createProjectFormGroups(t), [t])

  React.useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/staff/timesheets/time-projects?ids=${projectId}&pageSize=1`,
          undefined,
          { errorMessage: t('staff.timesheets.projects.errors.load', 'Failed to load project.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('staff.timesheets.projects.errors.notFound', 'Project not found.'))
        if (!cancelled) {
          setInitialValues({
            id: String(record.id ?? ''),
            name: String(record.name ?? ''),
            code: String(record.code ?? ''),
            description: typeof record.description === 'string' ? record.description : null,
            projectType: typeof (record.projectType ?? record.project_type) === 'string'
              ? String(record.projectType ?? record.project_type)
              : null,
            startDate: typeof (record.startDate ?? record.start_date) === 'string'
              ? String(record.startDate ?? record.start_date)
              : null,
            costCenter: typeof (record.costCenter ?? record.cost_center) === 'string'
              ? String(record.costCenter ?? record.cost_center)
              : null,
            status: typeof record.status === 'string' ? record.status : 'active',
          })
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load project.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [projectId, t, scopeVersion])

  if (loading) {
    return <Page><PageBody><LoadingMessage label={t('staff.timesheets.projects.loading', 'Loading project...')} /></PageBody></Page>
  }

  if (error || !initialValues) {
    return <Page><PageBody><ErrorMessage label={error ?? t('staff.timesheets.projects.errors.notFound', 'Project not found.')} /></PageBody></Page>
  }

  const detailHref = `/backend/staff/timesheets/projects/${projectId}`

  return (
    <Page>
      <PageBody>
        <CrudForm<ProjectFormValues>
          title={t('staff.timesheets.projects.form.editTitle', 'Edit project')}
          backHref={detailHref}
          cancelHref={detailHref}
          fields={fields}
          groups={groups}
          schema={formSchema}
          initialValues={initialValues}
          entityIds={[E.staff.staff_time_project]}
          submitLabel={t('staff.timesheets.projects.form.actions.save', 'Save')}
          onDelete={async () => {
            await deleteCrud('staff/timesheets/time-projects', projectId!, {
              errorMessage: t('staff.timesheets.projects.errors.delete', 'Failed to delete project.'),
            })
            flash(t('staff.timesheets.projects.messages.deleted', 'Project deleted.'), 'success')
            router.push(LIST_HREF)
          }}
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

            const payload = buildProjectPayload({ ...values, id: projectId })

            await updateCrud('staff/timesheets/time-projects', payload, {
              errorMessage: t('staff.timesheets.projects.errors.save', 'Failed to save project.'),
            })

            flash(t('staff.timesheets.projects.messages.saved', 'Project saved.'), 'success')
            router.push(detailHref)
          }}
          versionHistory={{
            resourceKind: 'staff.timesheets.time_project',
            resourceId: projectId!,
            canUndoRedo: true,
            autoCheckAcl: true,
          }}
        />
      </PageBody>
    </Page>
  )
}
