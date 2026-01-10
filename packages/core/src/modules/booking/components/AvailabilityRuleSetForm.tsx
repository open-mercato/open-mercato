"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'

export type AvailabilityRuleSetFormValues = {
  id?: string
  name?: string
  description?: string | null
  timezone?: string
} & Record<string, unknown>

export type AvailabilityRuleSetFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  initialValues: AvailabilityRuleSetFormValues
  onSubmit: (values: AvailabilityRuleSetFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export const buildAvailabilityRuleSetPayload = (
  values: AvailabilityRuleSetFormValues,
  options: { id?: string; timezone?: string } = {},
): Record<string, unknown> => {
  const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
  const timezone = typeof options.timezone === 'string' && options.timezone.trim().length
    ? options.timezone.trim()
    : 'UTC'
  return {
    ...(options.id ? { id: options.id } : {}),
    name: typeof values.name === 'string' ? values.name : '',
    description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
    timezone,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function AvailabilityRuleSetForm(props: AvailabilityRuleSetFormProps) {
  const {
    title,
    submitLabel,
    backHref,
    cancelHref,
    initialValues,
    onSubmit,
    onDelete,
    isLoading,
    loadingMessage,
  } = props
  const translate = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: translate('booking.availabilityRuleSets.form.fields.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: translate('booking.availabilityRuleSets.form.fields.description', 'Description'),
      type: 'richtext',
      editor: 'markdown',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => ([
    { id: 'details', fields: ['name', 'description'] },
    { id: 'customFields', title: translate('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ]), [translate])

  return (
    <CrudForm<AvailabilityRuleSetFormValues>
      title={title}
      backHref={backHref}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      fields={fields}
      groups={groups}
      entityId={E.booking.booking_availability_rule_set}
      initialValues={initialValues}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
  )
}
