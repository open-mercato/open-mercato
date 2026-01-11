"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'

export type TeamFormValues = {
  id?: string
  name: string
  description?: string | null
  isActive?: boolean
} & Record<string, unknown>

export type TeamFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  initialValues: TeamFormValues
  onSubmit: (values: TeamFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export const buildTeamPayload = (
  values: TeamFormValues,
  options: { id?: string } = {},
): Record<string, unknown> => {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  const description = typeof values.description === 'string' && values.description.trim().length
    ? values.description.trim()
    : null
  const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
  return {
    ...(options.id ? { id: options.id } : {}),
    name,
    description,
    isActive: values.isActive ?? true,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function TeamForm(props: TeamFormProps) {
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
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.teams.form.fields.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('booking.teams.form.fields.description', 'Description'), type: 'richtext' },
    { id: 'isActive', label: t('booking.teams.form.fields.active', 'Active'), type: 'checkbox' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description', 'isActive'] },
    { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ], [t])

  return (
    <CrudForm<TeamFormValues>
      title={title}
      backHref={backHref}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      fields={fields}
      groups={groups}
      entityId={E.booking.booking_team}
      initialValues={initialValues}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
  )
}
