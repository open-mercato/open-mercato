"use client"

import * as React from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { fetchCustomFieldFormFields } from '@open-mercato/ui/backend/utils/customFieldForms'

type CustomFieldsSectionProps = {
  entityId: string
  values: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  title: string
}

function formatFieldValue(field: CrudField, value: unknown, emptyLabel: string): React.ReactNode {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground">{emptyLabel}</span>
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">{emptyLabel}</span>
    return value.map((entry, index) => (
      <span key={`${field.id}-${index}`} className="mr-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
        {String(entry)}
      </span>
    ))
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

export function CustomFieldsSection({ entityId, values, onSubmit, title }: CustomFieldsSectionProps) {
  const t = useT()
  const emptyLabel = t('customers.people.detail.noValue')
  const [fields, setFields] = React.useState<CrudField[]>([])
  const [loading, setLoading] = React.useState(true)
  const [editing, setEditing] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const fetched = await fetchCustomFieldFormFields(entityId)
        if (!cancelled) setFields(fetched)
      } catch {
        if (!cancelled) setFields([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [entityId])

  const handleSubmit = React.useCallback(async (input: Record<string, unknown>) => {
    await onSubmit(input)
    setEditing(false)
  }, [onSubmit])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setEditing((prev) => !prev)}
          disabled={loading}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">{editing ? t('ui.forms.actions.cancel') : t('ui.forms.actions.edit')}</span>
        </Button>
      </div>
      <DataLoader
        isLoading={loading}
        loadingMessage={t('customers.people.detail.loading')}
        spinnerSize="md"
        className="min-h-[120px]"
      >
        {editing ? (
          <div className="rounded-lg border bg-card p-4">
            <CrudForm<Record<string, unknown>>
              embedded
              entityId={entityId}
              fields={fields}
              initialValues={values}
              onSubmit={handleSubmit}
              submitLabel={t('customers.people.detail.inline.save')}
              isLoading={loading}
            />
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('entities.customFields.empty')}</p>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {field.label}
                  </p>
                  <div className="text-sm break-words">
                    {formatFieldValue(field, values?.[field.id], emptyLabel)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DataLoader>
    </div>
  )
}

export default CustomFieldsSection
