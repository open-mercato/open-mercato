"use client"

/**
 * Task detail — decision beside context (spec §6.2).
 *
 * > "Task detail = decision + context side-by-side: left — instructions, form,
 * > decision buttons; right — bound entity card(s) with deep links. […] After
 * > completion: 'next task' — a one-click claim-next affordance."
 *
 * Three things about this page are load-bearing:
 *
 * - **The decision buttons are DERIVED, never stored.** The API re-resolves them
 *   per request from the instance's pinned definition
 *   (`lib/task-decisions.ts`), so no column carries the button list and a
 *   definition that gains a decision immediately offers it. Pressing one both
 *   completes the task and selects the outgoing route by the decision's durable
 *   `transitionId`; WHICH button was pressed is recorded server-side as part of
 *   the completion payload.
 * - **Every write goes through `useGuardedMutation`.** This page cannot use
 *   `CrudForm`, which is exactly the case the project rule names, and the
 *   mutation context carries `retryLastMutation` so the shared conflict/retry
 *   bar can re-run the last attempt.
 * - **Status is never colour-only** — every badge pairs its design-system token
 *   with an icon and a translated label (`lib/work-inbox/presentation.ts`).
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MobileTaskForm } from '../../../components/mobile/MobileTaskForm'
import { StatusChip } from '../../../components/work-inbox/StatusChip'
import { TaskFormFields } from '../../../components/work-inbox/TaskFormFields'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { UserTaskDecision, UserTaskResponse, UserTaskStatus } from '../../../data/types'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { WORK_INBOX_HREF, buildWorkInboxItemHref } from '../../../lib/work-inbox/navigation'
import {
  EntityContextPanel,
  bindingsToEntityContextItems,
} from '../../../components/work-inbox/EntityContextPanel'
import {
  WORK_INBOX_OVERDUE_TONE,
  describeWorkInboxPriority,
  describeWorkInboxStatus,
} from '../../../lib/work-inbox/presentation'
import { normalizeWorkInboxPriority } from '../../../lib/work-inbox/provider'
import { flattenTaskText } from '../../../lib/task-resolution'
import { readRecordedDecision } from '../../../lib/task-decisions'
import { normalizeTaskFormSchema } from '../../../lib/task-form-schema'

const logger = createLogger('workflows')

type TaskMutationContext = {
  formId: string
  taskId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function decisionButtonVariant(style: UserTaskDecision['style']): 'default' | 'outline' | 'destructive' {
  if (style === 'destructive') return 'destructive'
  if (style === 'secondary') return 'outline'
  return 'default'
}

export default function UserTaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const t = useT()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [formData, setFormData] = React.useState<Record<string, string | number | boolean>>({})
  const [comments, setComments] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  // Tracks the first required field that failed validation so we can mark the
  // field with aria-invalid + a red ring (Radix Select can't carry HTML
  // `required`, so we enforce constraint validation in JS instead).
  const [invalidField, setInvalidField] = React.useState<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<TaskMutationContext>({
    contextId: `workflows-task:${params.id}`,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const { data: task, isLoading, error } = useQuery({
    queryKey: ['workflow-task', params.id],
    queryFn: async () => {
      const result = await apiCall<{ data: UserTaskResponse }>(
        `/api/workflows/tasks/${params.id}`
      )
      if (!result.ok) {
        const httpErr = new Error(
          result.status === 404
            ? t('workflows.tasks.detail.notFound', 'Task not found')
            : t('workflows.tasks.detail.loadFailed', 'Failed to load task')
        ) as Error & { status: number }
        httpErr.status = result.status
        throw httpErr
      }
      return result.result?.data ?? null
    },
  })

  const mutationContext = React.useMemo<TaskMutationContext>(
    () => ({
      formId: `workflows-task:${params.id}`,
      taskId: params.id,
      resourceKind: 'workflows.user_task',
      resourceId: params.id,
      retryLastMutation,
    }),
    [params.id, retryLastMutation],
  )

  const refreshTask = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['workflow-task', params.id] })
  }, [params.id, queryClient])

  const handleFieldChange = (fieldName: string, value: string | number | boolean) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value,
    }))
    // Clear invalid state once the user touches the offending field.
    if (invalidField === fieldName) setInvalidField(null)
  }

  const validateRequiredFields = React.useCallback((): boolean => {
    // Normalized, so a Studio-authored `{ fields: [...] }` schema is validated
    // by the same rule the server enforces (`lib/task-form-schema.ts`).
    const normalizedSchema = normalizeTaskFormSchema(task?.formSchema)
    if (!normalizedSchema?.required) return true
    for (const requiredField of normalizedSchema.required) {
      if (!formData[requiredField] || formData[requiredField] === '') {
        const fieldSchema = normalizedSchema.properties?.[requiredField]
        const fieldLabel = fieldSchema?.title ?? requiredField
        flash(t('workflows.tasks.detail.validation.requiredField', { field: fieldLabel }), 'error')
        setInvalidField(requiredField)
        // Scroll + focus the trigger so the user sees what's missing.
        if (typeof document !== 'undefined') {
          const trigger = document.getElementById(requiredField)
          trigger?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          trigger?.focus()
        }
        return false
      }
    }
    setInvalidField(null)
    return true
  }, [formData, task, t])

  const completeTask = React.useCallback(
    async (decisionId?: string) => {
      if (!task) return
      if (!validateRequiredFields()) return

      setSubmitting(true)
      try {
        const result = await runMutation({
          operation: () =>
            apiCall(`/api/workflows/tasks/${params.id}/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                formData,
                comments: comments || undefined,
                ...(decisionId ? { decisionId } : {}),
              }),
            }),
          context: mutationContext,
          mutationPayload: { formData, comments, decisionId },
        })

        if (result.ok) {
          flash(t('workflows.tasks.messages.completed'), 'success')
          refreshTask()
        } else {
          const failure = result.result as { error?: string } | null
          flash(failure?.error || t('workflows.tasks.messages.completeFailed'), 'error')
        }
      } catch (err) {
        logger.error('Error completing task', { err })
        flash(t('workflows.tasks.messages.completeFailed'), 'error')
      } finally {
        setSubmitting(false)
      }
    },
    [comments, formData, mutationContext, params.id, refreshTask, runMutation, t, task, validateRequiredFields],
  )

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      void completeTask()
    },
    [completeTask],
  )

  const handleClaim = React.useCallback(async () => {
    setSubmitting(true)
    try {
      const result = await runMutation({
        operation: () => apiCall(`/api/workflows/tasks/${params.id}/claim`, { method: 'POST' }),
        context: mutationContext,
        mutationPayload: { action: 'claim' },
      })
      if (result.ok) {
        flash(t('workflows.tasks.messages.claimed'), 'success')
        refreshTask()
      } else {
        flash(t('workflows.tasks.messages.claimFailed'), 'error')
      }
    } catch (err) {
      logger.error('Error claiming task', { err })
      flash(t('workflows.tasks.messages.claimFailed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [mutationContext, params.id, refreshTask, runMutation, t])

  const handleNextTask = React.useCallback(async () => {
    setSubmitting(true)
    try {
      const result = await runMutation({
        operation: () =>
          apiCall<{ data: { id: string } | null }>('/api/workflows/work-inbox/next', {
            method: 'POST',
          }),
        context: mutationContext,
        mutationPayload: { action: 'claim-next' },
      })
      if (!result.ok) {
        flash(t('workflows.tasks.messages.claimFailed'), 'error')
        return
      }
      const claimed = result.result?.data ?? null
      if (!claimed) {
        flash(t('workflows.workInbox.messages.nothingClaimable'), 'info')
        return
      }
      flash(t('workflows.tasks.messages.claimed'), 'success')
      router.push(buildWorkInboxItemHref(claimed.id))
    } catch (err) {
      logger.error('Error claiming the next task', { err })
      flash(t('workflows.tasks.messages.claimFailed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [mutationContext, router, runMutation, t])

  const getStatusBadgeClass = React.useCallback(
    (status: UserTaskStatus) => describeWorkInboxStatus(status).badge,
    [],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center py-12">
            <Spinner />
            <span className="ml-3 text-muted-foreground">{t('workflows.tasks.detail.loading')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  const isNotFound = !isLoading && (error as (Error & { status?: number }) | null)?.status === 404

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('workflows.tasks.detail.notFound', 'Task not found')}
            backHref={WORK_INBOX_HREF}
            backLabel={t('workflows.tasks.detail.backToList', 'Back to Tasks')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !task) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={(error as Error | null)?.message ?? t('workflows.tasks.detail.loadFailed', 'Failed to load task')}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={WORK_INBOX_HREF}>{t('workflows.tasks.detail.backToList', 'Back to Tasks')}</Link>
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  const isCompletable = task.status === 'PENDING' || task.status === 'IN_PROGRESS'
  const isOverdue = Boolean(task.dueDate) && new Date(task.dueDate as string) < new Date() && isCompletable
  const statusDescriptor = describeWorkInboxStatus(task.status)
  const priority = normalizeWorkInboxPriority(task.priority)
  const priorityDescriptor = describeWorkInboxPriority(priority)
  const decisions = task.decisions ?? []
  const contextItems = bindingsToEntityContextItems(task.entityBindings, {
    noLink: t('workflows.tasks.detail.records.noLink'),
  })
  const recordedDecisionId = readRecordedDecision(task.formData)
  const recordedDecision = recordedDecisionId
    ? decisions.find((decision) => decision.id === recordedDecisionId) ?? null
    : null
  // A task nobody owns yet, offered to a role queue, is the one this operator
  // can take. An individually assigned task is already theirs to finish.
  const isClaimable =
    task.status === 'PENDING' &&
    !task.assignedTo &&
    !task.claimedBy &&
    (task.assignedToRoles?.length ?? 0) > 0

  if (isMobile) {
    return (
      <Page>
        <PageBody>
          <div className="space-y-4">
            <FormHeader
              mode="detail"
              backHref={WORK_INBOX_HREF}
              backLabel={t('workflows.tasks.backToList', 'Back to tasks')}
            />
            <MobileTaskForm
              task={task}
              formData={formData}
              comments={comments}
              submitting={submitting}
              isCompletable={isCompletable}
              isOverdue={isOverdue}
              onFieldChange={handleFieldChange}
              onCommentsChange={setComments}
              onSubmit={handleSubmit}
              onCancel={() => router.push(WORK_INBOX_HREF)}
              getStatusBadgeClass={getStatusBadgeClass}
              decisions={decisions}
              onDecision={(decisionId) => void completeTask(decisionId)}
            />
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <FormHeader
            mode="detail"
            backHref={WORK_INBOX_HREF}
            backLabel={t('workflows.tasks.backToList', 'Back to tasks')}
            entityTypeLabel={t('workflows.tasks.detail.type', 'User task')}
            title={task.taskName}
            subtitle={task.description || undefined}
            statusBadge={
              <span className="inline-flex items-center gap-2">
                <StatusChip
                  descriptor={statusDescriptor}
                  label={t(`workflows.tasks.statuses.${task.status}`, task.status)}
                />
                {priorityDescriptor && priority ? (
                  <StatusChip
                    descriptor={priorityDescriptor}
                    label={t(`workflows.workInbox.priorities.${priority}`, priority)}
                  />
                ) : null}
                {isOverdue ? (
                  <StatusChip
                    descriptor={WORK_INBOX_OVERDUE_TONE}
                    label={t('workflows.tasks.overdue')}
                  />
                ) : null}
              </span>
            }
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left — instructions, form, decisions */}
            <div className="space-y-6 lg:col-span-2">
              {isOverdue ? (
                <div className="bg-status-error-bg border border-status-error-border rounded-lg p-3">
                  <p className="text-sm text-status-error-text font-medium">
                    {t('workflows.tasks.detail.overdueWarning')}
                  </p>
                </div>
              ) : null}

              {task.description ? (
                <div className="rounded-lg border border-border p-4">
                  <h2 className="text-sm font-semibold mb-2">
                    {t('workflows.tasks.detail.sections.instructions')}
                  </h2>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
                </div>
              ) : null}

              {isClaimable ? (
                <div className="rounded-lg border border-border bg-muted/50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {t('workflows.tasks.detail.claimPrompt')}
                  </p>
                  <Button
                    type="button"
                    data-testid="task-claim"
                    disabled={submitting}
                    onClick={() => void handleClaim()}
                  >
                    {t('workflows.tasks.actions.claim')}
                  </Button>
                </div>
              ) : null}

              {!isCompletable ? (
                <div className="bg-status-info-bg border border-status-info-border rounded-lg p-4">
                  <p className="text-sm text-status-info-text">
                    {t('workflows.tasks.detail.cannotComplete')}
                  </p>
                </div>
              ) : null}

              {isCompletable ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <TaskFormFields
                    formSchema={task.formSchema}
                    values={formData}
                    invalidField={invalidField}
                    disabled={submitting}
                    onFieldChange={handleFieldChange}
                    formKey={task.formKey}
                    taskId={task.id}
                    taskName={task.taskName}
                    entityBindings={task.entityBindings}
                    decisions={decisions}
                    onValuesChange={setFormData}
                  />

                  <Separator />

                  <div className="space-y-2">
                    <label htmlFor="comments" className="block text-sm font-medium text-foreground">
                      {t('workflows.tasks.detail.comments')} ({t('workflows.tasks.detail.optional')})
                    </label>
                    <textarea
                      id="comments"
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder={t('workflows.tasks.detail.commentsPlaceholder')}
                    />
                  </div>

                  {decisions.length > 0 ? (
                    <div className="space-y-3" data-testid="task-decisions">
                      <h2 className="text-sm font-semibold">
                        {t('workflows.tasks.detail.sections.decisions')}
                      </h2>
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        {decisions.map((decision) => (
                          <Button
                            key={decision.id}
                            type="button"
                            data-testid={`task-decision-${decision.id}`}
                            variant={decisionButtonVariant(decision.style)}
                            disabled={submitting}
                            onClick={() => void completeTask(decision.id)}
                            className="w-full sm:w-auto"
                          >
                            {flattenTaskText(decision.label) ?? decision.id}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
                      <Button type="submit" data-testid="task-complete" disabled={submitting} className="w-full sm:w-auto">
                        {submitting
                          ? t('workflows.tasks.detail.submitting')
                          : t('workflows.tasks.detail.completeTask')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => router.push(WORK_INBOX_HREF)}
                        disabled={submitting}
                        className="w-full sm:w-auto"
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  )}
                </form>
              ) : null}

              {task.status === 'COMPLETED' ? (
                <div className="space-y-4">
                  {recordedDecisionId ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm text-muted-foreground">
                        {t('workflows.tasks.detail.decisionTaken')}:{' '}
                        <span className="text-foreground font-medium">
                          {recordedDecision
                            ? flattenTaskText(recordedDecision.label) ?? recordedDecisionId
                            : recordedDecisionId}
                        </span>
                      </p>
                    </div>
                  ) : null}

                  {task.formData ? (
                    <JsonDisplay
                      data={task.formData}
                      title={t('workflows.tasks.detail.sections.submittedData')}
                      maxInitialDepth={2}
                    />
                  ) : null}

                  {task.comments ? (
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-sm font-medium text-foreground mb-2">
                        {t('workflows.tasks.detail.comments')}:
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.comments}</p>
                    </div>
                  ) : null}

                  {/* Spec §6.2: keep frontline flow going with one click. */}
                  <div className="rounded-lg border border-border bg-muted/50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      {t('workflows.tasks.detail.nextTaskPrompt')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        data-testid="task-next"
                        disabled={submitting}
                        onClick={() => void handleNextTask()}
                      >
                        {t('workflows.workInbox.actions.claimNext')}
                      </Button>
                      <Button asChild variant="outline">
                        <Link href={WORK_INBOX_HREF}>{t('workflows.tasks.detail.backToList')}</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right — the records this task is about, plus how it got here */}
            <div className="space-y-4">
              <EntityContextPanel
                testId="task-context-records"
                title={t('workflows.tasks.detail.sections.records')}
                items={contextItems}
                emptyLabel={t('workflows.tasks.detail.records.empty')}
                linkLabel={t('workflows.tasks.detail.records.open')}
              />

              <div className="rounded-lg border border-border p-4 space-y-2">
                <h2 className="text-sm font-semibold">
                  {t('workflows.tasks.detail.sections.taskInfo')}
                </h2>
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('workflows.tasks.fields.createdAt')}:</span>
                    <span className="ml-2 text-foreground">{new Date(task.createdAt).toLocaleString()}</span>
                  </div>
                  {task.dueDate ? (
                    <div>
                      <span className="text-muted-foreground">{t('workflows.tasks.fields.dueDate')}:</span>
                      <span
                        className={`ml-2 ${isOverdue ? `${WORK_INBOX_OVERDUE_TONE.text} font-medium` : 'text-foreground'}`}
                      >
                        {new Date(task.dueDate).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                  {task.assignedTo ? (
                    <div>
                      <span className="text-muted-foreground">{t('workflows.tasks.detail.assignedTo')}:</span>
                      <span className="ml-2 text-foreground">{task.assignedTo}</span>
                    </div>
                  ) : null}
                  {task.assignedToRoles?.length ? (
                    <div>
                      <span className="text-muted-foreground">{t('workflows.tasks.roles')}:</span>
                      <span className="ml-2 text-foreground">{task.assignedToRoles.join(', ')}</span>
                    </div>
                  ) : null}
                  {task.claimedBy ? (
                    <div>
                      <span className="text-muted-foreground">{t('workflows.tasks.claimedBy')}:</span>
                      <span className="ml-2 text-foreground">{task.claimedBy}</span>
                    </div>
                  ) : null}
                  <div>
                    <span className="text-muted-foreground">
                      {t('workflows.tasks.detail.workflowInstance')}:
                    </span>
                    <Link
                      href={`/backend/instances/${task.workflowInstanceId}`}
                      className="ml-2 text-primary hover:underline text-xs font-mono"
                    >
                      {task.workflowInstanceId.slice(0, 8)}...
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
