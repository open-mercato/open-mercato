"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { HR_APPROVAL_TARGETS } from '../lib/approvalTargets'
import type { ApprovalWorkflowRow } from './ApprovalWorkflowsTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'hr_management:hr_approval_workflow'
const LIST_HREF = '/backend/hr/approval-workflows'
const RESOURCE = 'hr_management/approval-workflows'

export type ApprovalWorkflowFormValues = {
  id: string
  name: string
  code: string
  entityType: string
  description: string
  isActive: boolean
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/** Maps a loaded row into form values (snake_case from the list, camelCase in the form). */
export function toApprovalWorkflowFormValues(row: ApprovalWorkflowRow): ApprovalWorkflowFormValues {
  return {
    id: row.id,
    name: row.name ?? '',
    code: row.code ?? '',
    entityType: row.entity_type ?? HR_APPROVAL_TARGETS[0].value,
    description: row.description ?? '',
    // A workflow is active unless the row says otherwise, matching the column default.
    isActive: row.is_active !== false,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildApprovalWorkflowFormDefaults(id = ''): ApprovalWorkflowFormValues {
  return {
    id,
    name: '',
    code: '',
    entityType: HR_APPROVAL_TARGETS[0].value,
    description: '',
    isActive: true,
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * `entityType` is sent as the value the select chose: the engine compares this string, so the form
 * offers only the targets it implements rather than a free-text field that could never match.
 */
export function toApprovalWorkflowPayload(values: ApprovalWorkflowFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    entityType: values.entityType,
    description: values.description.trim().length > 0 ? values.description.trim() : null,
    isActive: values.isActive,
  }
}

type Translate = ReturnType<typeof useT>

function useWorkflowFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('hr_management.workflowConfig.form.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'code',
      label: t('hr_management.workflowConfig.form.fields.code', 'Code'),
      type: 'text',
      required: true,
      help: t('hr_management.workflowConfig.form.fields.codeHint', 'A short identifier for reports and integrations.'),
    },
    {
      id: 'entityType',
      label: t('hr_management.workflowConfig.form.fields.entityType', 'Applies to'),
      type: 'select',
      required: true,
      options: HR_APPROVAL_TARGETS.map((target) => ({
        value: target.value,
        label: t(target.labelKey, target.fallbackLabel),
      })),
      help: t('hr_management.workflowConfig.form.fields.entityTypeHint', 'Only the targets the approval engine implements can be selected.'),
    },
    {
      id: 'isActive',
      label: t('hr_management.workflowConfig.form.fields.isActive', 'Active'),
      type: 'checkbox',
      help: t('hr_management.workflowConfig.form.fields.isActiveHint', 'Only active workflows appear in the permission and leave pickers.'),
    },
    { id: 'description', label: t('hr_management.workflowConfig.form.fields.description', 'Description'), type: 'textarea', rows: 3 },
  ], [t])
}

function useWorkflowGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'workflow', title: t('hr_management.workflowConfig.form.groups.workflow'), column: 1, fields: ['name', 'code', 'entityType', 'isActive'] },
    { id: 'details', title: t('hr_management.workflowConfig.form.groups.details'), column: 2, fields: ['description'] },
  ], [t])
}

export function ApprovalWorkflowCreateForm() {
  const t = useT()
  const fields = useWorkflowFields(t)
  const groups = useWorkflowGroups(t)
  const initialValues = React.useMemo(() => buildApprovalWorkflowFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.workflowConfig.form.flash.saved', 'Workflow saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<ApprovalWorkflowFormValues>
      title={t('hr_management.workflowConfig.form.create.title', 'New approval workflow')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.workflowConfig.form.create.submit', 'Create workflow')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toApprovalWorkflowPayload(values))
      }}
    />
  )
}

export function ApprovalWorkflowEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useWorkflowFields(t)
  const groups = useWorkflowGroups(t)
  const [initial, setInitial] = React.useState<ApprovalWorkflowFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<ApprovalWorkflowRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toApprovalWorkflowFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.workflowConfig.form.error.load', 'Could not load the workflow.'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.workflowConfig.form.flash.saved', 'Workflow saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.workflowConfig.form.flash.deleted', 'Workflow deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.workflowConfig.form.error.notFound', 'Approval workflow not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.workflowConfig.actions.backToList', 'Back to workflows')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ApprovalWorkflowFormValues>
      title={t('hr_management.workflowConfig.form.edit.title', 'Edit approval workflow')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildApprovalWorkflowFormDefaults(id)}
      submitLabel={t('hr_management.workflowConfig.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.workflowConfig.form.loading', 'Loading workflow…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toApprovalWorkflowPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
