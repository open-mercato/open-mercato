'use client'

/**
 * The portal's task form.
 *
 * `components/mobile/MobileTaskForm.tsx` is the LAYOUT reference — it is a
 * backoffice component, it takes a backoffice `UserTaskResponse` and renders
 * backoffice chrome, so it is read and not imported. What is shared is the part
 * that must not diverge: the schema normalizer (`lib/task-form-schema.ts`) and
 * the external renderer registry (`lib/task-form-registry.ts`), so a form
 * authored once renders the same fields on both surfaces.
 *
 * Mobile-first: one column, full-width controls, stacked actions; the two-column
 * arrangement is the `sm:` enhancement, not the base.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeTaskFormSchema, readRequiredFormFields } from '../../lib/task-form-schema'
import { resolveTaskForm } from '../../lib/task-form-registry'
import type { JsonSchemaField } from '../../data/types'

export type PortalTaskFormValue = string | number | boolean

export type PortalTaskDecision = { id: string; label: string }

export type PortalTaskFormProps = {
  taskId: string
  taskName: string
  formSchema: unknown
  formKey: string | null
  entityBindings: unknown[] | null
  decisions: PortalTaskDecision[]
  values: Record<string, PortalTaskFormValue>
  comments: string
  submitting: boolean
  onFieldChange: (name: string, value: PortalTaskFormValue) => void
  onValuesChange: (values: Record<string, PortalTaskFormValue>) => void
  onCommentsChange: (value: string) => void
  onSubmit: (decisionId?: string) => void
}

function RequiredMark({ required }: { required: boolean }) {
  const t = useT()
  if (!required) return null
  return (
    <span className="ml-1 text-status-error-text" aria-label={t('workflows.portal.tasks.form.required', 'Required')}>
      *
    </span>
  )
}

export function PortalTaskForm(props: PortalTaskFormProps) {
  const t = useT()
  const {
    taskId,
    taskName,
    formSchema,
    formKey,
    entityBindings,
    decisions,
    values,
    comments,
    submitting,
    onFieldChange,
    onValuesChange,
    onCommentsChange,
    onSubmit,
  } = props

  const schema = React.useMemo(() => normalizeTaskFormSchema(formSchema), [formSchema])
  const required = React.useMemo(() => readRequiredFormFields(formSchema), [formSchema])
  const resolution = React.useMemo(() => resolveTaskForm(formKey), [formKey])

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      // A step that offers named outcomes must not also offer an unnamed one, or
      // the recorded decision becomes optional.
      if (decisions.length === 0) onSubmit()
    },
    [decisions.length, onSubmit],
  )

  const renderField = (name: string, field: JsonSchemaField) => {
    const label = field.title || name
    const isRequired = required.includes(name)
    const raw = values[name]
    const options = Array.isArray(field.enum) ? field.enum : null

    if (options?.length) {
      return (
        <div key={name} className="flex flex-col gap-2">
          <Label htmlFor={name}>
            {label}
            <RequiredMark required={isRequired} />
          </Label>
          <Select
            value={typeof raw === 'string' ? raw : ''}
            onValueChange={(value) => onFieldChange(name, value)}
            disabled={submitting}
          >
            <SelectTrigger id={name} className="w-full">
              <SelectValue placeholder={t('workflows.portal.tasks.form.select', 'Select…')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>
                  {String(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.description ? (
            <p className="text-sm text-muted-foreground">{field.description}</p>
          ) : null}
        </div>
      )
    }

    if (field.type === 'boolean') {
      return (
        <div key={name} className="flex items-start gap-3">
          <Checkbox
            id={name}
            checked={raw === true}
            onCheckedChange={(checked) => onFieldChange(name, checked === true)}
            disabled={submitting}
            className="mt-0.5"
          />
          <Label htmlFor={name} className="font-normal">
            {label}
            <RequiredMark required={isRequired} />
            {field.description ? (
              <span className="mt-0.5 block text-sm text-muted-foreground">{field.description}</span>
            ) : null}
          </Label>
        </div>
      )
    }

    const isLongText = field.type === 'string' && (field.description ?? '').length > 0 && !field.format

    return (
      <div key={name} className="flex flex-col gap-2">
        <Label htmlFor={name}>
          {label}
          <RequiredMark required={isRequired} />
        </Label>
        {isLongText ? (
          <Textarea
            id={name}
            value={typeof raw === 'boolean' ? '' : (raw ?? '')}
            onChange={(event) => onFieldChange(name, event.target.value)}
            disabled={submitting}
            rows={4}
          />
        ) : (
          <Input
            id={name}
            type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
            value={typeof raw === 'boolean' ? '' : (raw ?? '')}
            onChange={(event) =>
              onFieldChange(
                name,
                field.type === 'number' || field.type === 'integer'
                  ? Number(event.target.value)
                  : event.target.value,
              )
            }
            disabled={submitting}
          />
        )}
        {field.description && !isLongText ? (
          <p className="text-sm text-muted-foreground">{field.description}</p>
        ) : null}
      </div>
    )
  }

  const properties = schema?.properties ?? {}
  const fieldNames = Object.keys(properties)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {resolution.kind === 'missing' ? (
        // The author asked for a renderer nobody loaded. Falling back silently
        // would render a form that is not the one they designed, and the person
        // who can notice is the one looking at the screen — so say it out loud.
        <div
          role="status"
          className="rounded-lg border border-status-warning-border bg-status-warning-bg p-4 text-sm text-status-warning-text"
        >
          {t(
            'workflows.portal.tasks.form.rendererMissing',
            'This task asks for the "{formKey}" form, which is not available here. The standard form is shown instead.',
            { formKey: resolution.formKey },
          )}
        </div>
      ) : null}

      {resolution.kind === 'registered' ? (
        <resolution.entry.Renderer
          context={{
            taskId,
            taskName,
            formKey: resolution.entry.formKey,
            formSchema,
            entityBindings,
            decisions: decisions.map((decision) => ({ id: decision.id })),
            values,
            disabled: submitting,
          }}
          onChange={(next) => onValuesChange(next as Record<string, PortalTaskFormValue>)}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {fieldNames.length > 0 ? (
            fieldNames.map((name) => renderField(name, properties[name] as JsonSchemaField))
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(
                'workflows.portal.tasks.form.noFields',
                'This task has nothing to fill in — confirm it below when you are done.',
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="portal-task-comments">
          {t('workflows.portal.tasks.form.comments', 'Comments')}
        </Label>
        <Textarea
          id="portal-task-comments"
          value={comments}
          onChange={(event) => onCommentsChange(event.target.value)}
          disabled={submitting}
          rows={3}
          placeholder={t('workflows.portal.tasks.form.commentsPlaceholder', 'Anything to add? (optional)')}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {decisions.length > 0 ? (
          decisions.map((decision) => (
            <Button
              key={decision.id}
              type="button"
              disabled={submitting}
              onClick={() => onSubmit(decision.id)}
              className="w-full sm:w-auto"
            >
              {decision.label}
            </Button>
          ))
        ) : (
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            {submitting
              ? t('workflows.portal.tasks.form.submitting', 'Submitting…')
              : t('workflows.portal.tasks.form.submit', 'Complete task')}
          </Button>
        )}
      </div>
    </form>
  )
}
