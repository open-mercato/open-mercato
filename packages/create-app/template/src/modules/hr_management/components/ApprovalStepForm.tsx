"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useWorkflowOptions } from './hrOptions'
import { loadHrRoleOptions, loadHrUserOptions } from './userOptions'
import type { ApprovalStepRow } from './ApprovalStepsTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'hr_management:hr_approval_step_definition'
const LIST_HREF = '/backend/hr/approval-steps'
const RESOURCE = 'hr_management/approval-steps'

export const APPROVER_TYPE_VALUES = ['role', 'user', 'manager'] as const

export const APPROVER_TYPE_FALLBACKS: Record<(typeof APPROVER_TYPE_VALUES)[number], string> = {
  role: 'A role',
  user: 'A named user',
  manager: 'The employee’s manager',
}

export type ApprovalStepFormValues = {
  id: string
  workflowId: string
  stepOrder: string
  name: string
  approverType: (typeof APPROVER_TYPE_VALUES)[number]
  approverRoleId: string
  approverUserId: string
  requiredApprovals: string
  isFinal: boolean
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/** Maps a loaded row into form values (snake_case from the list, camelCase in the form). */
export function toApprovalStepFormValues(row: ApprovalStepRow): ApprovalStepFormValues {
  return {
    id: row.id,
    workflowId: row.workflow_id ?? '',
    stepOrder: row.step_order === null || row.step_order === undefined ? '' : String(row.step_order),
    name: row.name ?? '',
    approverType: row.approver_type ?? 'user',
    approverRoleId: row.approver_role_id ?? '',
    approverUserId: row.approver_user_id ?? '',
    requiredApprovals: row.required_approvals === null || row.required_approvals === undefined
      ? '1'
      : String(row.required_approvals),
    isFinal: row.is_final === true,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildApprovalStepFormDefaults(id = '', workflowId = ''): ApprovalStepFormValues {
  return {
    id,
    workflowId,
    stepOrder: '',
    name: '',
    approverType: 'user',
    approverRoleId: '',
    approverUserId: '',
    requiredApprovals: '1',
    isFinal: false,
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * Only the approver the chosen type actually uses is sent: leaving the other one in place would store
 * a target the engine ignores, and a later switch of type would then look configured when it is not.
 */
export function toApprovalStepPayload(values: ApprovalStepFormValues): Record<string, unknown> {
  const order = Number.parseInt(values.stepOrder, 10)
  const required = Number.parseInt(values.requiredApprovals, 10)
  return {
    workflowId: values.workflowId,
    stepOrder: Number.isFinite(order) ? order : 1,
    name: values.name.trim(),
    approverType: values.approverType,
    approverRoleId: values.approverType === 'role' ? values.approverRoleId : null,
    approverUserId: values.approverType === 'user' ? values.approverUserId : null,
    requiredApprovals: Number.isFinite(required) && required > 0 ? required : 1,
    isFinal: values.isFinal,
  }
}

/**
 * The same rule the service enforces, checked before the request leaves: a step whose approver type
 * has no target can never be decided, and the operator should be told which field to fill rather than
 * shown a server message about a request that will now sit still. The messages come from the caller,
 * which has the translator.
 */
export function assertStepApproverChosen(
  values: ApprovalStepFormValues,
  messages: { userRequired: string; roleRequired: string },
): void {
  if (values.approverType === 'user' && values.approverUserId.trim().length === 0) {
    throw createCrudFormError('[internal] step approver user missing', { approverUserId: messages.userRequired })
  }
  if (values.approverType === 'role' && values.approverRoleId.trim().length === 0) {
    throw createCrudFormError('[internal] step approver role missing', { approverRoleId: messages.roleRequired })
  }
}

type Translate = ReturnType<typeof useT>
type Option = { value: string; label: string }

/** Loads both approver lookups once, so the fields can switch their visible target. */
function useApproverOptions() {
  const [users, setUsers] = React.useState<Option[]>([])
  const [roles, setRoles] = React.useState<Option[]>([])
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [loadedUsers, loadedRoles] = await Promise.all([loadHrUserOptions(), loadHrRoleOptions()])
      if (cancelled) return
      setUsers(loadedUsers)
      setRoles(loadedRoles)
    })()
    return () => { cancelled = true }
  }, [])
  return { users, roles }
}

function useStepFields(
  t: Translate,
  workflowOptions: Option[],
  users: Option[],
  roles: Option[],
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'workflowId',
      label: t('hr_management.workflowConfig.steps.form.fields.workflow', 'Workflow'),
      type: 'select',
      required: true,
      options: workflowOptions,
    },
    {
      id: 'stepOrder',
      label: t('hr_management.workflowConfig.steps.form.fields.order', 'Order'),
      type: 'number',
      required: true,
      help: t('hr_management.workflowConfig.steps.form.fields.orderHint', 'Approvals run from the lowest order upwards.'),
    },
    { id: 'name', label: t('hr_management.workflowConfig.steps.form.fields.name', 'Step name'), type: 'text', required: true },
    {
      id: 'approverType',
      label: t('hr_management.workflowConfig.steps.form.fields.approverType', 'Approved by'),
      type: 'select',
      required: true,
      options: APPROVER_TYPE_VALUES.map((value) => ({
        value,
        label: t(`hr_management.workflowConfig.approverTypes.${value}`, APPROVER_TYPE_FALLBACKS[value]),
      })),
    },
    {
      id: 'approverUserId',
      label: t('hr_management.workflowConfig.steps.form.fields.approverUser', 'User'),
      type: 'select',
      // Only the target the chosen type uses is shown, mirroring what the payload sends: a step
      // carries one approver, not a pair of them.
      visibleWhen: { field: 'approverType', equals: 'user' },
      options: [{ value: '', label: t('hr_management.workflowConfig.steps.form.fields.approverUserNone', 'Select a user') }, ...users],
    },
    {
      id: 'approverRoleId',
      label: t('hr_management.workflowConfig.steps.form.fields.approverRole', 'Role'),
      type: 'select',
      visibleWhen: { field: 'approverType', equals: 'role' },
      options: [{ value: '', label: t('hr_management.workflowConfig.steps.form.fields.approverRoleNone', 'Select a role') }, ...roles],
    },
    {
      id: 'requiredApprovals',
      label: t('hr_management.workflowConfig.steps.form.fields.required', 'Approvals needed'),
      type: 'number',
      help: t('hr_management.workflowConfig.steps.form.fields.requiredHint', 'How many decisions this step needs before it passes.'),
    },
    {
      id: 'isFinal',
      label: t('hr_management.workflowConfig.steps.form.fields.isFinal', 'Final step'),
      type: 'checkbox',
      help: t('hr_management.workflowConfig.steps.form.fields.isFinalHint', 'Approving the final step approves the whole request.'),
    },
  ], [t, workflowOptions, users, roles])
}

function useStepGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'step', title: t('hr_management.workflowConfig.steps.form.groups.step'), column: 1, fields: ['workflowId', 'stepOrder', 'name'] },
    { id: 'approval', title: t('hr_management.workflowConfig.steps.form.groups.approval'), column: 2, fields: ['approverType', 'approverUserId', 'approverRoleId', 'requiredApprovals', 'isFinal'] },
  ], [t])
}

/** The workflow options a step form chooses from, plus the choice it starts on. */
function useWorkflowChoices(preselectedWorkflowId?: string) {
  const { workflows } = useWorkflowOptions()
  const options = React.useMemo<Option[]>(
    () => workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
    [workflows],
  )
  return { options, preselectedWorkflowId: preselectedWorkflowId ?? '' }
}

export function ApprovalStepCreateForm({ workflowId }: { workflowId?: string } = {}) {
  const t = useT()
  const workflowChoices = useWorkflowChoices(workflowId)
  const { users, roles } = useApproverOptions()
  const fields = useStepFields(t, workflowChoices.options, users, roles)
  const groups = useStepGroups(t)
  const initialValues = React.useMemo(
    () => buildApprovalStepFormDefaults('', workflowChoices.preselectedWorkflowId),
    [workflowChoices.preselectedWorkflowId],
  )
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.workflowConfig.steps.form.flash.saved', 'Step saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<ApprovalStepFormValues>
      title={t('hr_management.workflowConfig.steps.form.create.title', 'New approval step')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.workflowConfig.steps.form.create.submit', 'Create step')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        assertStepApproverChosen(values, {
          userRequired: t('hr_management.workflowConfig.steps.form.errors.approverUser', 'Choose the user who approves this step.'),
          roleRequired: t('hr_management.workflowConfig.steps.form.errors.approverRole', 'Choose the role that approves this step.'),
        })
        await createCrud(RESOURCE, toApprovalStepPayload(values))
      }}
    />
  )
}

export function ApprovalStepEditForm({ id }: { id: string }) {
  const t = useT()
  const workflowChoices = useWorkflowChoices()
  const { users, roles } = useApproverOptions()
  const fields = useStepFields(t, workflowChoices.options, users, roles)
  const groups = useStepGroups(t)
  const [initial, setInitial] = React.useState<ApprovalStepFormValues | null>(null)
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
        const data = await fetchCrudList<ApprovalStepRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toApprovalStepFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.workflowConfig.steps.form.error.load', 'Could not load the step.'))
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
    () => withFlash(LIST_HREF, t('hr_management.workflowConfig.steps.form.flash.saved', 'Step saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.workflowConfig.steps.form.flash.deleted', 'Step deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.workflowConfig.steps.form.error.notFound', 'Approval step not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.workflowConfig.steps.actions.backToList', 'Back to steps')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ApprovalStepFormValues>
      title={t('hr_management.workflowConfig.steps.form.edit.title', 'Edit approval step')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildApprovalStepFormDefaults(id)}
      submitLabel={t('hr_management.workflowConfig.steps.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.workflowConfig.steps.form.loading', 'Loading step…')}
      onSubmit={async (values) => {
        assertStepApproverChosen(values, {
          userRequired: t('hr_management.workflowConfig.steps.form.errors.approverUser', 'Choose the user who approves this step.'),
          roleRequired: t('hr_management.workflowConfig.steps.form.errors.approverRole', 'Choose the role that approves this step.'),
        })
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toApprovalStepPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
