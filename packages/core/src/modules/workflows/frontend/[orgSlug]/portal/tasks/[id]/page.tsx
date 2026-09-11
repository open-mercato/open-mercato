'use client'

/**
 * Portal task detail + completion.
 *
 * `canComplete` comes from the API, not from anything this page computes: a
 * portal admin reading a company member's task gets `false` and sees the work
 * read-only. The completion route enforces the same answer independently, so
 * hiding the form is a courtesy and never the control.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import { PortalTaskForm, type PortalTaskFormValue } from '../../../../../components/portal/PortalTaskForm'
import { flattenTaskText } from '../../../../../lib/task-resolution'

type PortalTaskDetail = {
  id: string
  taskName: string
  description: string | null
  status: string
  dueDate: string | null
  formSchema: unknown
  formData: unknown
  entityBindings: unknown[] | null
}

type PortalTaskDetailResponse = {
  ok: boolean
  task?: PortalTaskDetail
  decisions?: Array<{ id: string; label: unknown }>
  formKey?: string | null
  canComplete?: boolean
  error?: string
}

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS']

type Props = { params: { orgSlug: string; id: string } }

export default function PortalTaskDetailPage({ params }: Props) {
  const t = useT()
  const router = useRouter()

  const [detail, setDetail] = React.useState<PortalTaskDetailResponse | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, PortalTaskFormValue>>({})
  const [comments, setComments] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [failure, setFailure] = React.useState<'load' | 'submit' | null>(null)

  const listHref = `/${params.orgSlug}/portal/tasks`

  // Depends on the id alone. The failure copy is translated at render rather
  // than stored, so a `t` that changes identity cannot re-run this effect.
  const load = React.useCallback(async () => {
    const { ok, status, result } = await apiCall<PortalTaskDetailResponse>(
      `/api/workflows/portal/tasks/${encodeURIComponent(params.id)}`,
    )
    if (status === 404) {
      setNotFound(true)
      return
    }
    if (!ok || !result?.ok) {
      setFailure('load')
      return
    }
    setDetail(result)
  }, [params.id])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent('workflows.task.portal_assigned', () => {
    void load()
  }, [load])

  const task = detail?.task ?? null
  const decisions = React.useMemo(
    () =>
      (detail?.decisions ?? []).map((decision) => ({
        id: decision.id,
        label: flattenTaskText(decision.label as never) ?? decision.id,
      })),
    [detail?.decisions],
  )

  const handleSubmit = React.useCallback(
    async (decisionId?: string) => {
      if (!task) return
      setSubmitting(true)
      setFailure(null)
      const { ok, result } = await apiCall<{ ok: boolean; error?: string }>(
        `/api/workflows/portal/tasks/${encodeURIComponent(task.id)}/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            formData: values,
            ...(comments ? { comments } : {}),
            ...(decisionId ? { decisionId } : {}),
          }),
        },
      )
      setSubmitting(false)
      if (!ok || !result?.ok) {
        setFailure('submit')
        return
      }
      router.push(listHref)
    },
    [task, values, comments, router, listHref],
  )

  if (notFound) {
    return (
      <div className="flex flex-col gap-6">
        <PortalPageHeader title={t('workflows.portal.tasks.detail.notFound', 'Task not available')} />
        <PortalCard>
          <p className="text-sm text-muted-foreground">
            {t(
              'workflows.portal.tasks.detail.notFoundBody',
              'This task is not available to you. It may have been completed or reassigned.',
            )}
          </p>
          <Link
            href={listHref}
            className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
          >
            {t('workflows.portal.tasks.detail.back', 'Back to tasks')}
          </Link>
        </PortalCard>
      </div>
    )
  }

  if (!detail || !task) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  const isOpen = OPEN_STATUSES.includes(task.status)
  const canComplete = detail.canComplete === true && isOpen

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('workflows.portal.tasks.label', 'Your work')}
        title={task.taskName}
        description={task.description ?? undefined}
        action={
          <Badge variant="outline" className="text-overline">
            {t(`workflows.portal.tasks.status.${task.status}`, task.status)}
          </Badge>
        }
      />

      <PortalCard>
        {canComplete ? (
          <PortalTaskForm
            taskId={task.id}
            taskName={task.taskName}
            formSchema={task.formSchema}
            formKey={detail.formKey ?? null}
            entityBindings={task.entityBindings}
            decisions={decisions}
            values={values}
            comments={comments}
            submitting={submitting}
            onFieldChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
            onValuesChange={setValues}
            onCommentsChange={setComments}
            onSubmit={handleSubmit}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {isOpen
              ? t(
                  'workflows.portal.tasks.detail.readOnly',
                  'You can see this task because it belongs to your company. Only the person it is assigned to can complete it.',
                )
              : t('workflows.portal.tasks.detail.closed', 'This task is already finished.')}
          </p>
        )}

        {failure ? (
          <p role="alert" className="mt-4 text-sm text-status-error-text">
            {failure === 'submit'
              ? t('workflows.portal.tasks.submitError', 'Could not submit this task.')
              : t('workflows.portal.tasks.loadError', 'Could not load your tasks.')}
          </p>
        ) : null}
      </PortalCard>

      <Link href={listHref} className="text-sm font-medium underline underline-offset-4">
        {t('workflows.portal.tasks.detail.back', 'Back to tasks')}
      </Link>
    </div>
  )
}
