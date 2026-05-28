"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { fetchCustomFieldFormStructure } from '@open-mercato/ui/backend/utils/customFieldForms'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { E } from '#generated/entities.ids.generated'
import { DealCustomFieldControl } from './dealCustomFieldControl'

export type DealCustomAttributesLoadState = {
  fields: CrudField[]
  definitions: CustomFieldDefDto[]
}

export type DealCustomAttributesProps = {
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  errors?: Record<string, string>
  disabled?: boolean
  manageHref: string
  labels: {
    manage: string
    empty: string
    loading: string
  }
  onLoaded?: (state: DealCustomAttributesLoadState) => void
}

function ManageFieldsLink({ href, label }: { href: string; label: string }) {
  return (
    <LinkButton asChild variant="gray" size="sm">
      <a href={href} className="inline-flex items-center gap-1">
        <Plus className="size-3.5" />
        {label}
      </a>
    </LinkButton>
  )
}

export function DealCustomAttributes({
  values,
  onChange,
  errors,
  disabled = false,
  manageHref,
  labels,
  onLoaded,
}: DealCustomAttributesProps) {
  const [fields, setFields] = React.useState<CrudField[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const onLoadedRef = React.useRef(onLoaded)

  React.useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetchCustomFieldFormStructure([E.customers.customer_deal])
      .then((result) => {
        if (cancelled) return
        setFields(result.fields)
        setIsLoading(false)
        onLoadedRef.current?.({ fields: result.fields, definitions: result.definitions })
      })
      .catch(() => {
        if (cancelled) return
        setFields([])
        setIsLoading(false)
        onLoadedRef.current?.({ fields: [], definitions: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {labels.loading}
      </div>
    )
  }

  if (fields.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
        <ManageFieldsLink href={manageHref} label={labels.manage} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <DealCustomFieldControl
          key={field.id}
          field={field}
          value={values[field.id]}
          onChange={(next) => onChange(field.id, next)}
          error={errors?.[field.id]}
          disabled={disabled}
        />
      ))}
      <div className="pt-1">
        <ManageFieldsLink href={manageHref} label={labels.manage} />
      </div>
    </div>
  )
}

export default DealCustomAttributes
