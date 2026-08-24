"use client"

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DEFAULT_BUDGET_WARN_AT_PERCENT, type ProjectBudgetKind } from '../../../../../../lib/time-tracking-ui/ProjectFormSections'
import { NoProjectAccess } from '../../../../../../lib/time-tracking-ui/NoProjectAccess'
import {
  buildProjectPayload,
  createProjectFormFields,
  createProjectFormGroups,
  createProjectFormSchema,
  type ProjectFormValues,
} from '../../projectFormConfig'

const LIST_HREF = '/backend/staff/time-tracking/projects'

/**
 * Mirrors `NO_PROJECT_ACCESS_REASON` from
 * `api/timesheets/time-projects/route.ts`. The route module is server-only, so
 * the literal is restated here rather than imported into the client bundle;
 * `__tests__/no-project-access-contract.test.ts` pins the two together.
 */
const NO_PROJECT_ACCESS_REASON = 'no_project_access'

/** Thrown by the loader so the caller can branch on the guard state. */
class ProjectAccessDeniedError extends Error {
  constructor() {
    super('[internal] no project access')
    this.name = 'ProjectAccessDeniedError'
  }
}

type ProjectRecord = Record<string, unknown>

function readString(record: ProjectRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number') return String(value)
  }
  return null
}

function readSnapshot(record: ProjectRecord): Record<string, unknown> | null {
  const raw = record.customerSnapshot ?? record.customer_snapshot
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  return null
}

function toValues(record: ProjectRecord): ProjectFormValues {
  const snapshot = readSnapshot(record)
  const budgetKindRaw = readString(record, 'budgetKind', 'budget_kind') ?? 'none'
  const budgetKind: ProjectBudgetKind =
    budgetKindRaw === 'hours' || budgetKindRaw === 'amount' ? budgetKindRaw : 'none'
  const entryCount = typeof record.entryCount === 'number' ? record.entryCount : 0

  return {
    id: String(record.id ?? ''),
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
    name: String(record.name ?? ''),
    code: String(record.code ?? ''),
    // D-10: an existing project keeps the code it was saved with — the name no
    // longer drives it.
    codeManual: true,
    customerId: readString(record, 'customerId', 'customer_id'),
    customerName: typeof snapshot?.name === 'string' ? snapshot.name : null,
    customerKind: typeof snapshot?.kind === 'string' ? snapshot.kind : null,
    customerTaxId: typeof snapshot?.taxId === 'string' ? snapshot.taxId : null,
    description: readString(record, 'description'),
    hourlyRate: readString(record, 'hourlyRate', 'hourly_rate'),
    currencyCode: readString(record, 'currencyCode', 'currency_code'),
    currencyLocked: record.currencyLocked === true,
    entryCount,
    billableByDefault: (record.billableByDefault ?? record.billable_by_default) !== false,
    budgetEnabled: budgetKind !== 'none',
    budgetKind: budgetKind === 'none' ? 'hours' : budgetKind,
    budgetValue: readString(record, 'budgetValue', 'budget_value'),
    budgetWarnAtPercent:
      readString(record, 'budgetWarnAtPercent', 'budget_warn_at_percent') ?? String(DEFAULT_BUDGET_WARN_AT_PERCENT),
    projectType: readString(record, 'projectType', 'project_type'),
    color: readString(record, 'color'),
    startDate: readString(record, 'startDate', 'start_date'),
    costCenter: readString(record, 'costCenter', 'cost_center'),
    status: readString(record, 'status') ?? 'active',
  }
}

export default function TimeTrackingProjectEditPage({ params }: { params?: { id?: string } }) {
  const projectId = params?.id
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [initialValues, setInitialValues] = React.useState<ProjectFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [accessDenied, setAccessDenied] = React.useState(false)

  const fetchProject = React.useCallback(async (): Promise<ProjectRecord | null> => {
    const call = await apiCall<{ items?: ProjectRecord[]; reason?: unknown }>(
      `/api/staff/timesheets/time-projects?ids=${projectId}&pageSize=1`,
    )
    if (call.status === 404 && call.result?.reason === NO_PROJECT_ACCESS_REASON) {
      throw new ProjectAccessDeniedError()
    }
    if (!call.ok) {
      throw new Error(t('staff.timesheets.projects.errors.load', 'Failed to load project.'))
    }
    const record = Array.isArray(call.result?.items) ? call.result.items[0] : null
    return record ?? null
  }, [projectId, t])

  /**
   * D-3: the change-currency action writes to the project directly, so it bumped
   * both the currency and `updated_at`. Reload the record — the form derives its
   * optimistic-lock version from `initialValues.updatedAt`, and a stale one would
   * fail the next save with a conflict this same user had just caused. `CrudForm`
   * merges refreshed initial values without discarding fields being edited.
   */
  const handleCurrencyChanged = React.useCallback(() => {
    if (!projectId) return
    void fetchProject()
      .then((record) => { if (record) setInitialValues(toValues(record)) })
      .catch(() => {
        // Best effort: the optimistic-lock conflict bar remains the backstop.
      })
  }, [fetchProject, projectId])

  const formSchema = React.useMemo(() => createProjectFormSchema(), [])
  const fields = React.useMemo(
    () => createProjectFormFields(t, { onCurrencyChanged: handleCurrencyChanged }),
    [t, handleCurrencyChanged],
  )
  const groups = React.useMemo(() => createProjectFormGroups(t), [t])

  React.useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      setAccessDenied(false)
      try {
        const record = await fetchProject()
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitialValues(toValues(record))
      } catch (err) {
        if (cancelled) return
        if (err instanceof ProjectAccessDeniedError) {
          setAccessDenied(true)
          return
        }
        setError(
          err instanceof Error
            ? err.message
            : t('staff.timesheets.projects.errors.load', 'Failed to load project.'),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [projectId, fetchProject, scopeVersion, t])

  if (loading) {
    return <Page><PageBody><LoadingMessage label={t('staff.timesheets.projects.loading', 'Loading project...')} /></PageBody></Page>
  }

  // Screen 17 — the caller may not open this project. Same guard state the
  // detail page renders; it names neither the customer nor the project.
  if (accessDenied) {
    return <NoProjectAccess timeProjectId={projectId} />
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('staff.timesheets.projects.errors.notFound', 'Project not found.')}
            backHref={LIST_HREF}
            backLabel={t('staff.timesheets.projects.actions.backToList', 'Back to projects')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !initialValues) {
    return <Page><PageBody><ErrorMessage label={error ?? t('staff.timesheets.projects.errors.load', 'Failed to load project.')} /></PageBody></Page>
  }

  const detailHref = `/backend/staff/time-tracking/projects/${projectId}`

  return (
    <Page>
      <PageBody>
        <CrudForm<ProjectFormValues>
          title={t('staff.time_tracking.projects.form.editTitle', 'Edit project')}
          backHref={detailHref}
          cancelHref={detailHref}
          fields={fields}
          groups={groups}
          schema={formSchema}
          initialValues={initialValues}
          entityIds={[E.staff.staff_time_project]}
          injectionSpotId={extensionPoints.hosts.projectForm.spotId}
          submitLabel={t('staff.timesheets.projects.form.actions.save', 'Save')}
          onDelete={async () => {
            await deleteCrud('staff/timesheets/time-projects', projectId!, {
              errorMessage: t('staff.timesheets.projects.errors.delete', 'Failed to delete project.'),
            })
            flash(t('staff.timesheets.projects.messages.deleted', 'Project deleted.'), 'success')
            router.push(LIST_HREF)
          }}
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
