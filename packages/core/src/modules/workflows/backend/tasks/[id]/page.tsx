"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type UserTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

type UserTask = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string
  taskName: string
  description: string | null
  status: UserTaskStatus
  formSchema: any | null
  formData: any | null
  assignedTo: string | null
  assignedToRoles: string[] | null
  claimedBy: string | null
  claimedAt: string | null
  dueDate: string | null
  completedBy: string | null
  completedAt: string | null
  comments: string | null
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

export default function UserTaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const t = useT()
  const [formData, setFormData] = React.useState<Record<string, any>>({})
  const [comments, setComments] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const { data: task, isLoading, error } = useQuery({
    queryKey: ['workflow-task', params.id],
    queryFn: async () => {
      const result = await apiCall<{ data: UserTask }>(
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
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!task) return

    // Validate required fields
    if (task.formSchema?.required) {
      for (const requiredField of task.formSchema.required) {
        if (!formData[requiredField] || formData[requiredField] === '') {
          flash(t('workflows.tasks.detail.validation.requiredField', { field: requiredField }), 'error')
          return
        }
      }
    }

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

  const renderFormField = (fieldName: string, fieldSchema: any) => {
    const fieldType = fieldSchema.type || 'string'
    const fieldTitle = fieldSchema.title || fieldName
    const fieldDescription = fieldSchema.description
    const required = task?.formSchema?.required?.includes(fieldName) || false
    const enumValues = fieldSchema.enum

    const inputClasses = "w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
    const labelClasses = "block text-sm font-medium text-foreground mb-1"

    // Handle enum (select dropdown)
    if (enumValues && Array.isArray(enumValues)) {
      return (
        <div key={fieldName} className="space-y-2">
          <label htmlFor={fieldName} className={labelClasses}>
            {fieldTitle}
            {required && <span className="text-red-600 ml-1">*</span>}
          </label>
          {fieldDescription && (
            <p className="text-xs text-muted-foreground">{fieldDescription}</p>
          )}
          <select
            id={fieldName}
            value={formData[fieldName] || ''}
            onChange={(e) => handleFieldChange(fieldName, e.target.value)}
            required={required}
            className={inputClasses}
          >
            <option value="">{t('workflows.tasks.detail.form.selectOption')}</option>
            {enumValues.map((value: any) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
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
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              <input
                type="email"
                id={fieldName}
                value={formData[fieldName] || ''}
                onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                required={required}
                className={inputClasses}
              />
            </div>
          )
        }
        if (fieldSchema.format === 'date') {
          return (
            <div key={fieldName} className="space-y-2">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              <input
                type="date"
                id={fieldName}
                value={formData[fieldName] || ''}
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
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              <textarea
                id={fieldName}
                value={formData[fieldName] || ''}
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
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground">{fieldDescription}</p>
            )}
            <input
              type="text"
              id={fieldName}
              value={formData[fieldName] || ''}
              onChange={(e) => handleFieldChange(fieldName, e.target.value)}
              required={required}
              className={inputClasses}
            />
          </div>
        )

      case 'number':
      case 'integer':
        return (
          <div key={fieldName} className="space-y-2">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground">{fieldDescription}</p>
            )}
            <input
              type="number"
              id={fieldName}
              value={formData[fieldName] || ''}
              onChange={(e) => handleFieldChange(fieldName, e.target.value ? Number(e.target.value) : '')}
              required={required}
              step={fieldType === 'integer' ? 1 : 'any'}
              className={inputClasses}
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
                className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
              />
              <label htmlFor={fieldName} className="text-sm font-medium text-foreground">
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
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
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && (
              <p className="text-xs text-muted-foreground">{fieldDescription}</p>
            )}
            <input
              type="text"
              id={fieldName}
              value={formData[fieldName] || ''}
              onChange={(e) => handleFieldChange(fieldName, e.target.value)}
              required={required}
              className={inputClasses}
            />
          </div>
        )
    }
  }

  const getStatusBadgeClass = (status: UserTaskStatus) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800'
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-800 dark:text-blue-200'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'CANCELLED':
        return 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
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
            <p className="text-red-600">{t('workflows.tasks.detail.notFound')}</p>
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

  return (
    <Page>
      <PageBody>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/backend/tasks"
                className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
              >
                <span aria-hidden className="mr-1 text-base">←</span>
                <span className="sr-only">{t('workflows.tasks.backToList', 'Back to tasks')}</span>
              </Link>
              <div className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">
                  {t('workflows.tasks.detail.type', 'User task')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{task.taskName}</h1>
                </div>
                {task.description && (
                  <p className="text-sm text-muted-foreground">{task.description}</p>
                )}
              </div>
            </div>
            <span
              className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${getStatusBadgeClass(
                task.status
              )}`}
            >
              {t(`workflows.tasks.status.${task.status}`)}
            </span>
          </div>

          <div className="space-y-3">

            {isOverdue && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800 font-medium">
                  {t('workflows.tasks.detail.overdueWarning')}
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Task Information */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold">{t('workflows.tasks.detail.sections.taskInfo')}</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t('workflows.tasks.fields.createdAt')}:</span>
                <span className="ml-2 text-foreground">{new Date(task.createdAt).toLocaleString()}</span>
              </div>
              {task.dueDate && (
                <div>
                  <span className="text-muted-foreground">{t('workflows.tasks.fields.dueDate')}:</span>
                  <span className={`ml-2 ${isOverdue ? 'text-red-600 font-medium' : 'text-foreground'}`}>
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
            <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-200">
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
                    {Object.keys(task.formSchema.properties).map((fieldName) =>
                      renderFormField(fieldName, task.formSchema.properties[fieldName])
                    )}
                  </div>
                )}

                {!task.formSchema?.properties && (
                  <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
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
                    className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder={t('workflows.tasks.detail.commentsPlaceholder')}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-4">
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {submitting ? t('workflows.tasks.detail.submitting') : t('workflows.tasks.detail.completeTask')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/backend/tasks')}
                    disabled={submitting}
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
