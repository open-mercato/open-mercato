'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type UserTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

interface JsonSchema {
  type?: string
  title?: string
  properties?: Record<string, JsonSchemaField>
  required?: string[]
}

interface JsonSchemaField {
  type?: string
  title?: string
  enum?: string[]
  format?: string
  description?: string
  maxLength?: number
}

type UserTask = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string
  taskName: string
  description: string | null
  status: UserTaskStatus
  formSchema: JsonSchema | null
  formData: Record<string, string | number | boolean> | null
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

interface MobileTaskFormProps {
  task: UserTask
  formData: Record<string, string | number | boolean>
  comments: string
  submitting: boolean
  isCompletable: boolean
  isOverdue: boolean | null | undefined
  onFieldChange: (fieldName: string, value: string | number | boolean) => void
  onCommentsChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  getStatusBadgeClass: (status: UserTaskStatus) => string
}

export function MobileTaskForm({
  task,
  formData,
  comments,
  submitting,
  isCompletable,
  isOverdue,
  onFieldChange,
  onCommentsChange,
  onSubmit,
  onCancel,
  getStatusBadgeClass,
}: MobileTaskFormProps) {
  const t = useT()

  const fieldValue = (fieldName: string): string | number => {
    const val = formData[fieldName]
    if (val == null || val === false) return ''
    if (typeof val === 'boolean') return ''
    return val
  }

  const renderFormField = (fieldName: string, fieldSchema: JsonSchemaField) => {
    const fieldType = fieldSchema.type || 'string'
    const fieldTitle = fieldSchema.title || fieldName
    const fieldDescription = fieldSchema.description
    const required = task.formSchema?.required?.includes(fieldName) || false
    const enumValues = fieldSchema.enum

    const inputClasses = "w-full h-11 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-base"
    const labelClasses = "block text-sm font-medium text-foreground mb-1"

    if (enumValues && Array.isArray(enumValues)) {
      return (
        <div key={fieldName} className="space-y-2">
          <label htmlFor={fieldName} className={labelClasses}>
            {fieldTitle}
            {required && <span className="text-red-600 ml-1">*</span>}
          </label>
          {fieldDescription && <p className="text-xs text-muted-foreground">{fieldDescription}</p>}
          <select
            id={fieldName}
            value={fieldValue(fieldName)}
            onChange={(e) => onFieldChange(fieldName, e.target.value)}
            required={required}
            className={inputClasses}
          >
            <option value="">{t('workflows.tasks.detail.form.selectOption')}</option>
            {enumValues.map((value: string) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
      )
    }

    switch (fieldType) {
      case 'string':
        if (fieldSchema.maxLength && fieldSchema.maxLength > 200) {
          return (
            <div key={fieldName} className="space-y-2">
              <label htmlFor={fieldName} className={labelClasses}>
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {fieldDescription && <p className="text-xs text-muted-foreground">{fieldDescription}</p>}
              <textarea
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(e) => onFieldChange(fieldName, e.target.value)}
                required={required}
                rows={4}
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-base"
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
            {fieldDescription && <p className="text-xs text-muted-foreground">{fieldDescription}</p>}
            <input
              type={fieldSchema.format === 'email' ? 'email' : fieldSchema.format === 'date' ? 'date' : 'text'}
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(e) => onFieldChange(fieldName, e.target.value)}
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
            {fieldDescription && <p className="text-xs text-muted-foreground">{fieldDescription}</p>}
            <input
              type="number"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(e) => onFieldChange(fieldName, e.target.value ? Number(e.target.value) : '')}
              required={required}
              step={fieldType === 'integer' ? 1 : 'any'}
              className={inputClasses}
            />
          </div>
        )

      case 'boolean':
        return (
          <div key={fieldName} className="space-y-2">
            <div className="flex items-center gap-3 h-11">
              <input
                type="checkbox"
                id={fieldName}
                checked={!!formData[fieldName]}
                onChange={(e) => onFieldChange(fieldName, e.target.checked)}
                className="w-5 h-5 text-primary border-border rounded focus:ring-primary"
              />
              <label htmlFor={fieldName} className="text-sm font-medium text-foreground">
                {fieldTitle}
                {required && <span className="text-red-600 ml-1">*</span>}
              </label>
            </div>
            {fieldDescription && <p className="text-xs text-muted-foreground">{fieldDescription}</p>}
          </div>
        )

      default:
        return (
          <div key={fieldName} className="space-y-2">
            <label htmlFor={fieldName} className={labelClasses}>
              {fieldTitle}
              {required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {fieldDescription && <p className="text-xs text-muted-foreground">{fieldDescription}</p>}
            <input
              type="text"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(e) => onFieldChange(fieldName, e.target.value)}
              required={required}
              className={inputClasses}
            />
          </div>
        )
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-lg font-semibold">{task.taskName}</h1>
        <span className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(task.status)}`}>
          {t(`workflows.tasks.statuses.${task.status}`)}
        </span>
      </div>

      {task.description && (
        <p className="text-sm text-muted-foreground">{task.description}</p>
      )}

      {isOverdue && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium">{t('workflows.tasks.detail.overdueWarning')}</p>
        </div>
      )}

      <div className="rounded-lg bg-muted/50 p-3 space-y-2.5">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground">{t('workflows.tasks.detail.sections.taskInfo')}</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('workflows.tasks.fields.createdAt')}:</span>
            <span className="text-right text-xs">{new Date(task.createdAt).toLocaleString()}</span>
          </div>
          {task.dueDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('workflows.tasks.fields.dueDate')}:</span>
              <span className={`text-right text-xs ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                {new Date(task.dueDate).toLocaleString()}
              </span>
            </div>
          )}
          {task.assignedTo && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('workflows.tasks.detail.assignedTo')}:</span>
              <span className="text-right">{task.assignedTo}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('workflows.tasks.detail.workflowInstance')}:</span>
            <Link
              href={`/backend/instances/${task.workflowInstanceId}`}
              className="text-primary hover:underline text-xs font-mono"
            >
              {task.workflowInstanceId.slice(0, 8)}...
            </Link>
          </div>
        </div>
      </div>

      {!isCompletable && (
        <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <p className="text-sm text-blue-800 dark:text-blue-200">{t('workflows.tasks.detail.cannotComplete')}</p>
        </div>
      )}

      {isCompletable && (
        <form onSubmit={onSubmit} className="space-y-4">
          {task.formSchema?.properties && (
            <>
              <Separator />
              <h2 className="text-base font-semibold">{t('workflows.tasks.detail.sections.form')}</h2>
              <div className="space-y-4">
                {Object.keys(task.formSchema!.properties!).map((fieldName) =>
                  renderFormField(fieldName, task.formSchema!.properties![fieldName])
                )}
              </div>
            </>
          )}

          {!task.formSchema?.properties && (
            <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">{t('workflows.tasks.detail.noFormSchema')}</p>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <label htmlFor="m-comments" className="block text-sm font-medium text-foreground">
              {t('workflows.tasks.detail.comments')} ({t('workflows.tasks.detail.optional')})
            </label>
            <textarea
              id="m-comments"
              value={comments}
              onChange={(e) => onCommentsChange(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-base"
              placeholder={t('workflows.tasks.detail.commentsPlaceholder')}
            />
          </div>

          <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3 z-10">
            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 h-11"
              >
                {submitting ? t('workflows.tasks.detail.submitting') : t('workflows.tasks.detail.completeTask')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={submitting}
                className="h-11"
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </form>
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
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm font-medium text-foreground mb-1">{t('workflows.tasks.detail.comments')}:</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.comments}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
