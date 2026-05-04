"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MobileTaskForm } from '../../../components/mobile/MobileTaskForm'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { UserTaskResponse, UserTaskStatus } from '../../../data/types'

export default function UserTaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const t = useT()
  const isMobile = useIsMobile()
  const [formData, setFormData] = React.useState<Record<string, string | number | boolean>>({})
  const [comments, setComments] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  // Tracks the first required field that failed validation so we can mark the
  // field with aria-invalid + a red ring (Radix Select can't carry HTML
  // `required`, so we enforce constraint validation in JS instead).
  const [invalidField, setInvalidField] = React.useState<string | null>(null)

  const { data: task, isLoading, error } = useQuery({
    queryKey: ['workflow-task', params.id],
    queryFn: async () => {
      const result = await apiCall<{ data: UserTaskResponse }>(
        `/api/workflows/tasks/${params.id}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch task')
      }

      return result.result?.data || null
    },
  })

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value,
    }))
    // Clear invalid state once the user touches the offending field.
    if (invalidField === fieldName) setInvalidField(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!task) return

    // Validate required fields. Radix Select doesn't expose HTML `required`,
    // so we enforce constraint validation here and surface it visually via
    // `invalidField` + aria-invalid on the offending field.
    if (task.formSchema?.required) {
      for (const requiredField of task.formSchema.required) {
        if (!formData[requiredField] || formData[requiredField] === '') {
          const fieldSchema = task.formSchema.properties?.[requiredField]
          const fieldLabel = fieldSchema?.title ?? requiredField
          flash(t('workflows.tasks.detail.validation.requiredField', { field: fieldLabel }), 'error')
          setInvalidField(requiredField)
          // Scroll + focus the trigger so the user sees what's missing.
          if (typeof document !== 'undefined') {
            const trigger = document.getElementById(requiredField)
            trigger?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            trigger?.focus()
          }
          return
        }
      }
    }
    setInvalidField(null)

    setSubmitting(true)

    try {
      const result = await apiCall(`/api/workflows/tasks/${params.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formData,
          comments: comments || undefined,
        }),
      })

      if (result.ok) {
        flash(t('workflows.tasks.messages.completed'), 'success')
        router.push('/backend/tasks')
      } else {
        const error = result.result as any
        flash(error?.error || t('workflows.tasks.messages.completeFailed'), 'error')
      }
    } catch (err) {
      console.error('Error completing task:', err)
      flash(t('workflows.tasks.messages.completeFailed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const fieldValue = (fieldName: string): string | number => {
    const val = formData[fieldName]
    if (val == null || val === false) return ''
    if (typeof val === 'boolean') return ''
    return val
  }

  const renderFormField = (fieldName: string, fieldSchema: any) => {
    const fieldType = fieldSchema.type || 'string'
    const fieldTitle = fieldSchema.title || fieldName
    const fieldDescription = fieldSchema.description
    const required = task?.formSchema?.required?.includes(fieldName) || false
    const enumValues = fieldSchema.enum

    const inputClasses = "w-full px-3 py-2 border border-border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    const labelClasses = "block text-sm font-medium text-foreground mb-1"

    // Handle enum (select dropdown)
    if (enumValues && Array.isArray(enumValues)) {
      return (
        <div key={fieldName} className="space-y-2">
          <label htmlFor={fieldName} className={labelClasses}>
            {fieldTitle}
            {required && <span className="text-status-error-text ml-1">*</span>}
          </label>
          {fieldDescription && (
            <p className="text-xs text-muted-foreground">{fieldDescription}</p>
          )}
          <Select
            value={fieldValue(fieldName) ? String(fieldValue(fieldName)) : undefined}
            onValueChange={(value) => handleFieldChange(fieldName, value ?? '')}
          >
            <SelectTrigger
              id={fieldName}
              className={`${inputClasses} ${invalidField === fieldName ? 'ring-2 ring-status-error-border border-status-error-border' : ''}`}
              aria-required={required}
              aria-invalid={invalidField === fieldName ? true : undefined}
            >
              <SelectValue placeholder={t('workflows.tasks.detail.form.selectOption')} />
            </SelectTrigger>
            <SelectContent>
              {enumValues.map((value: any) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    // Handle different field types
    switch (fieldType) {
      case 'string':
        if (fieldSchema.format === 'email') {
          return (
            <div key={fieldName} className="space-y-2">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-status-error-text ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              <Input
                type="email"
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
              />
            </div>
          )
        }
        if (fieldSchema.format === 'date') {
          return (
            <div key={fieldName} className="space-y-2">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-status-error-text ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              <input
                type="date"
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
                className={inputClasses}
              />
            </div>
          )
        }
        if (fieldSchema.maxLength && fieldSchema.maxLength > 200) {
          return (
            <div key={fieldName} className="space-y-2">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-status-error-text ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              <textarea
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
                rows={4}
                className={inputClasses}
              />
            </div>
          )
        }
        return (
          <div key={fieldName} className="space-y-2">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-status-error-text ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground">{fieldDescription}</p>
            )}
            <Input
              type="text"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(e) => handleFieldChange(fieldName, e.target.value)}
              required={required}
            />
          </div>
        )

      case 'number':
      case 'integer':
        return (
          <div key={fieldName} className="space-y-2">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-status-error-text ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground">{fieldDescription}</p>
            )}
            <Input
              type="number"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(e) => handleFieldChange(fieldName, e.target.value ? Number(e.target.value) : '')}
              required={required}
              step={fieldType === 'integer' ? 1 : 'any'}
            />
          </div>
        )

      case 'boolean':
        return (
          <div key={fieldName} className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={fieldName}
                checked={!!formData[fieldName]}
                onChange={(e) => handleFieldChange(fieldName, e.target.checked)}
                className="w-4 h-4 text-primary border-border rounded focus-visible:ring-ring"
              />
              <label htmlFor={fieldName} className="text-sm font-medium text-foreground">
                {fieldTitle}
                {required && <span className="text-status-error-text ml-1">*</span>}
              </label>
            </div>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground ml-6">{fieldDescription}</p>
            )}
          </div>
        )

      default:
        return (
          <div key={fieldName} className="space-y-2">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-status-error-text ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground">{fieldDescription}</p>
            )}
            <Input
              type="text"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(e) => handleFieldChange(fieldName, e.target.value)}
              required={required}
            />
          </div>
        )
    }
  }

  const getStatusBadgeClass = (status: UserTaskStatus) => {
    switch (status) {
      case 'PENDING':
        return 'bg-status-warning-bg text-status-warning-text'
      case 'IN_PROGRESS':
        return 'bg-status-info-bg text-status-info-text'
      case 'COMPLETED':
        return 'bg-status-success-bg text-status-success-text'
      case 'CANCELLED':
        return 'bg-muted text-foreground'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

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

  if (error || !task) {
    return (
      <Page>
        <PageBody>
          <div className="p-8 text-center">
            <p className="text-status-error-text">{t('workflows.tasks.detail.notFound')}</p>
            <Button onClick={() => router.push('/backend/tasks')} className="mt-4">
              {t('workflows.tasks.detail.backToList')}
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const isCompletable = task.status === 'PENDING' || task.status === 'IN_PROGRESS'
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && isCompletable

  if (isMobile) {
    return (
      <Page>
        <PageBody>
          <div className="space-y-4">
            <FormHeader
              mode="detail"
              backHref="/backend/tasks"
              backLabel={t('workflows.tasks.backToList', 'Back to tasks')}
            />
            <MobileTaskForm
              task={task}
              formData={formData}
              comments={comments}
              submitting={submitting}
              isCompletable={isCompletable}
              isOverdue={!!isOverdue}
              onFieldChange={handleFieldChange}
              onCommentsChange={setComments}
              onSubmit={handleSubmit}
              onCancel={() => router.push('/backend/tasks')}
              getStatusBadgeClass={getStatusBadgeClass}
            />
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="max-w-4xl mx-auto space-y-6">
          <FormHeader
            mode="detail"
            backHref="/backend/tasks"
            backLabel={t('workflows.tasks.backToList', 'Back to tasks')}
            entityTypeLabel={t('workflows.tasks.detail.type', 'User task')}
            title={task.taskName}
            subtitle={task.description || undefined}
            statusBadge={
              <span
                className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${getStatusBadgeClass(task.status)}`}
              >
                {t(`workflows.tasks.statuses.${task.status}`)}
              </span>
            }
          />

          <div className="space-y-3">

            {isOverdue && (
              <div className="bg-status-error-bg border border-status-error-border rounded-lg p-3">
                <p className="text-sm text-status-error-text font-medium">
                  {t('workflows.tasks.detail.overdueWarning')}
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Task Information */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold">{t('workflows.tasks.detail.sections.taskInfo')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t('workflows.tasks.fields.createdAt')}:</span>
                <span className="ml-2 text-foreground">{new Date(task.createdAt).toLocaleString()}</span>
              </div>
              {task.dueDate && (
                <div>
                  <span className="text-muted-foreground">{t('workflows.tasks.fields.dueDate')}:</span>
                  <span className={`ml-2 ${isOverdue ? 'text-status-error-text font-medium' : 'text-foreground'}`}>
                    {new Date(task.dueDate).toLocaleString()}
                  </span>
                </div>
              )}
              {task.assignedTo && (
                <div>
                  <span className="text-muted-foreground">{t('workflows.tasks.detail.assignedTo')}:</span>
                  <span className="ml-2 text-foreground">{task.assignedTo}</span>
                </div>
              )}
              {task.claimedBy && (
                <div>
                  <span className="text-muted-foreground">{t('workflows.tasks.claimedBy')}:</span>
                  <span className="ml-2 text-foreground">{task.claimedBy}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">{t('workflows.tasks.detail.workflowInstance')}:</span>
                <Link
                  href={`/backend/instances/${task.workflowInstanceId}`}
                  className="ml-2 text-primary hover:underline text-xs font-mono"
                >
                  {task.workflowInstanceId.slice(0, 8)}...
                </Link>
              </div>
            </div>
          </div>

          {!isCompletable && (
            <div className="bg-status-info-bg border border-status-info-border rounded-lg p-4">
              <p className="text-sm text-status-info-text">
                {t('workflows.tasks.detail.cannotComplete')}
              </p>
            </div>
          )}

          {isCompletable && (
            <>
              <Separator />

              {/* Dynamic Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                {task.formSchema?.properties && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold">{t('workflows.tasks.detail.sections.form')}</h2>
                    {Object.keys(task.formSchema!.properties!).map((fieldName) =>
                      renderFormField(fieldName, task.formSchema!.properties![fieldName])
                    )}
                  </div>
                )}

                {!task.formSchema?.properties && (
                  <div className="bg-status-info-bg border border-status-info-border rounded-lg p-4">
                    <p className="text-sm text-status-info-text">
                      {t('workflows.tasks.detail.noFormSchema')}
                    </p>
                  </div>
                )}

                <Separator />

                {/* Comments */}
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

                {/* Actions */}
                <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {submitting ? t('workflows.tasks.detail.submitting') : t('workflows.tasks.detail.completeTask')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/backend/tasks')}
                    disabled={submitting}
                    className="w-full sm:w-auto"
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            </>
          )}

          {task.status === 'COMPLETED' && task.formData && (
            <>
              <Separator />
              <JsonDisplay
                data={task.formData}
                title={t('workflows.tasks.detail.sections.submittedData')}
                maxInitialDepth={2}
              />
              {task.comments && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm font-medium text-foreground mb-2">{t('workflows.tasks.detail.comments')}:</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.comments}</p>
                </div>
              )}
            </>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
