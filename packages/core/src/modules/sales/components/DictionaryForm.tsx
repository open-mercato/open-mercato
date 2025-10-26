"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@/lib/i18n/context'

export type DictionaryFormMode = 'create' | 'edit'

export type DictionaryFormProps<TValues extends Record<string, any>> = {
  apiPath: string
  mode: DictionaryFormMode
  entityId?: string | string[]
  title?: string
  titleKey?: string
  submitLabel?: string
  submitLabelKey?: string
  fields: CrudField[]
  groups?: CrudFormGroup[]
  initialValues?: Partial<TValues>
  transformValues?: (values: TValues) => Record<string, unknown>
  onSuccess?: (payload: any) => void
  onError?: (message: string) => void
  deleteId?: string | null
  enableDelete?: boolean
  cancelHref?: string
  successRedirect?: string
  deleteRedirect?: string
  extraActions?: React.ReactNode
  embedded?: boolean
  loading?: boolean
  loadingMessageKey?: string
}

function normalizeCustomFields(input: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const collected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('cf_')) {
      collected[key.slice(3)] = value
    } else if (key.startsWith('cf:')) {
      collected[key.slice(3)] = value
    } else {
      payload[key] = value
    }
  }
  if (Object.keys(collected).length > 0) {
    payload.customFields = {
      ...(typeof payload.customFields === 'object' && payload.customFields !== null
        ? (payload.customFields as Record<string, unknown>)
        : {}),
      ...collected,
    }
  }
  return payload
}

export function DictionaryForm<TValues extends Record<string, any>>({
  apiPath,
  mode,
  entityId,
  title,
  titleKey,
  submitLabel,
  submitLabelKey,
  fields,
  groups,
  initialValues,
  transformValues,
  onSuccess,
  onError,
  deleteId,
  enableDelete = false,
  cancelHref,
  successRedirect,
  deleteRedirect,
  extraActions,
  embedded,
  loading = false,
  loadingMessageKey,
}: DictionaryFormProps<TValues>): JSX.Element {
  const t = useT()

  const resolvedEntityIds = React.useMemo(() => {
    if (!entityId) return undefined
    return Array.isArray(entityId) ? entityId : [entityId]
  }, [entityId])

  const resolvedTitle = React.useMemo(() => {
    if (typeof title === 'string' && title.trim().length > 0) return title
    if (titleKey) return t(titleKey)
    return mode === 'create'
      ? t('sales.configuration.form.createTitle', 'Create record')
      : t('sales.configuration.form.editTitle', 'Edit record')
  }, [title, titleKey, mode, t])

  const resolvedSubmitLabel = React.useMemo(() => {
    if (typeof submitLabel === 'string' && submitLabel.trim().length > 0) return submitLabel
    if (submitLabelKey) return t(submitLabelKey)
    return mode === 'create'
      ? t('sales.configuration.form.submitCreate', 'Create')
      : t('sales.configuration.form.submitUpdate', 'Save changes')
  }, [submitLabel, submitLabelKey, mode, t])

  const resolvedLoadingMessage = React.useMemo(() => {
    if (!loadingMessageKey) return undefined
    return t(loadingMessageKey)
  }, [loadingMessageKey, t])

  const buildPayload = React.useCallback(
    (values: TValues): Record<string, unknown> => {
      const base = transformValues ? transformValues(values) : values
      return normalizeCustomFields(base as Record<string, unknown>)
    },
    [transformValues]
  )

  const handleSubmit = React.useCallback(
    async (values: TValues) => {
      const payload = buildPayload(values)
      try {
        const response =
          mode === 'create'
            ? await createCrud(apiPath, payload)
            : await updateCrud(apiPath, payload)
        let parsed: any = null
        try {
          parsed = await response.clone().json()
        } catch {
          parsed = null
        }
        onSuccess?.(parsed)
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.configuration.errors.save_failed', 'Failed to save record.')
        onError?.(message)
        throw new Error(message)
      }
    },
    [apiPath, buildPayload, mode, onError, onSuccess, t]
  )

  const handleDelete = React.useCallback(async () => {
    if (!deleteId) {
      const message = t('sales.configuration.errors.id_required', 'Record identifier is required.')
      onError?.(message)
      throw new Error(message)
    }
    try {
      const response = await deleteCrud(apiPath, deleteId)
      let parsed: any = null
      try {
        parsed = await response.clone().json()
      } catch {
        parsed = null
      }
      onSuccess?.(parsed)
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.configuration.errors.delete_failed', 'Failed to delete record.')
      onError?.(message)
      throw new Error(message)
    }
  }, [apiPath, deleteId, onError, onSuccess, t])

  return (
    <CrudForm<TValues>
      title={resolvedTitle}
      fields={fields}
      groups={groups}
      entityIds={resolvedEntityIds}
      initialValues={initialValues as TValues | undefined}
      submitLabel={resolvedSubmitLabel}
      cancelHref={cancelHref}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      onSubmit={handleSubmit}
      onDelete={enableDelete ? handleDelete : undefined}
      deleteVisible={enableDelete}
      extraActions={extraActions}
      embedded={embedded}
      isLoading={loading}
      loadingMessage={resolvedLoadingMessage}
    />
  )
}

