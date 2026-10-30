'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type UiFieldSpec = {
  name: string
  kind: 'text' | 'textarea' | 'number' | 'select' | 'customer_tag' | 'boolean'
  labelKey: string
  required?: boolean
  options?: { value: string; labelKey: string }[]
}

type TagOption = { id: string; label: string }

/**
 * Renders a step's parameters from the metadata its handler declares.
 *
 * Generic on purpose: this is what lets a step type contributed by another module get a working
 * inspector form without shipping any UI of its own.
 */
export function ParamFields({
  fields,
  values,
  onChange,
}: {
  fields: UiFieldSpec[]
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const t = useT()
  const [tags, setTags] = React.useState<TagOption[] | null>(null)
  /**
   * Whether the tag list could not be loaded, which is a third state and not the same as "no tags".
   *
   * An empty picker says "this installation has no tags, go and make one"; a failed request says nothing at
   * all and used to look identical. Worse, an `apiCall` that threw left `tags` null forever, so the field was
   * a spinner that never resolved and the author could not tell whether to wait.
   */
  const [tagsFailed, setTagsFailed] = React.useState(false)
  const needsTags = fields.some((field) => field.kind === 'customer_tag')

  React.useEffect(() => {
    if (!needsTags || tags !== null) return
    let cancelled = false
    void (async () => {
      try {
        const result = await apiCall<{ items?: Array<Record<string, unknown>> }>('/api/customers/tags?pageSize=100')
        if (cancelled) return
        if (!result.ok || !Array.isArray(result.result?.items)) {
          setTagsFailed(true)
          setTags([])
          return
        }
        setTags(result.result.items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            const label = typeof item.label === 'string'
              ? item.label
              : typeof item.slug === 'string' ? item.slug : id
            return id && label ? { id, label } : null
          })
          .filter((option): option is TagOption => option !== null))
      } catch {
        if (cancelled) return
        setTagsFailed(true)
        setTags([])
      }
    })()
    return () => { cancelled = true }
  }, [needsTags, tags])

  const set = (name: string, value: unknown) => onChange({ ...values, [name]: value })

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const label = t(field.labelKey, field.name)
        const value = values[field.name]
        const id = `param-${field.name}`

        if (field.kind === 'boolean') {
          return (
            <CheckboxField
              key={field.name}
              id={id}
              label={label}
              // Absent means on: a step's schema supplies the default, and an unchecked box for a
              // parameter the author never touched would misreport what the step will do.
              checked={value === undefined ? true : value === true}
              onCheckedChange={(next) => set(field.name, next === true)}
            />
          )
        }

        if (field.kind === 'textarea') {
          return (
            <div key={field.name} className="space-y-1">
              <Label htmlFor={id}>{label}</Label>
              <Textarea
                id={id}
                rows={6}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(field.name, event.target.value)}
              />
            </div>
          )
        }

        if (field.kind === 'number') {
          return (
            <div key={field.name} className="space-y-1">
              <Label htmlFor={id}>{label}</Label>
              <Input
                id={id}
                type="number"
                value={typeof value === 'number' ? String(value) : ''}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  set(field.name, Number.isFinite(parsed) ? parsed : undefined)
                }}
              />
            </div>
          )
        }

        if (field.kind === 'customer_tag' || field.kind === 'select') {
          // The tag list is fetched, so the field says it is loading rather than briefly
          // rendering an empty picker that looks like "no tags exist".
          if (field.kind === 'customer_tag' && tags === null) {
            return (
              <div key={field.name} className="space-y-1">
                <Label htmlFor={id}>{label}</Label>
                <div className="flex h-9 items-center px-1"><Spinner /></div>
              </div>
            )
          }
          if (field.kind === 'customer_tag' && tagsFailed) {
            return (
              <div key={field.name} className="space-y-1">
                <Label htmlFor={id}>{label}</Label>
                <div className="text-xs text-status-error-text">
                  {t('marketing_automation.params.tagsUnavailable', 'The tag list could not be loaded. Reload the page to try again.')}
                </div>
              </div>
            )
          }
          const options = field.kind === 'customer_tag'
            ? (tags ?? []).map((tag) => ({ value: tag.id, label: tag.label }))
            : (field.options ?? []).map((option) => ({ value: option.value, label: t(option.labelKey, option.value) }))

          return (
            <div key={field.name} className="space-y-1">
              <Label htmlFor={id}>{label}</Label>
              <select
                id={id}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(field.name, event.target.value || undefined)}
              >
                <option value="">—</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )
        }

        return (
          <div key={field.name} className="space-y-1">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => set(field.name, event.target.value)}
            />
          </div>
        )
      })}
    </div>
  )
}
