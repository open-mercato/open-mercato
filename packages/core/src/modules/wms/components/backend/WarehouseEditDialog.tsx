"use client"

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { flashMutationError } from '../../lib/flashMutationError'
import {
  countryOptionFromStored,
  loadCountryOptions,
  loadTimezoneOptions,
  timezoneOptionFromStored,
} from './warehouseFormOptions'

export type WarehouseDialogRow = {
  id: string
  name?: string | null
  code?: string | null
  city?: string | null
  country?: string | null
  timezone?: string | null
  is_active?: boolean | null
  is_primary?: boolean | null
  updated_at?: string | null
  updatedAt?: string | null
  customValues?: Record<string, unknown> | null
}

export type WarehouseFormValues = {
  name: string
  code: string
  city?: string
  country?: string
  timezone?: string
  isActive: boolean
  isPrimary: boolean
}

export const warehouseFormSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  isActive: z.boolean().default(true),
  isPrimary: z.boolean().default(false),
}).passthrough()

type WarehouseEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  row?: WarehouseDialogRow | null
  onSaved?: (info: {
    mode: 'create' | 'edit'
    id?: string
    values: WarehouseFormValues
    updatedAt?: string | null
  }) => void | Promise<void>
}

export function WarehouseEditDialog({ open, onOpenChange, mode, row, onSaved }: WarehouseEditDialogProps) {
  const t = useT()
  const locale = useLocale()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'wms-config-warehouses' })
  const [submitting, setSubmitting] = React.useState(false)

  const countrySeedOptions = React.useMemo(() => {
    if (mode !== 'edit' || !row?.country?.trim()) return undefined
    return [countryOptionFromStored(row.country, locale)]
  }, [locale, mode, row])

  const timezoneSeedOptions = React.useMemo(() => {
    if (mode !== 'edit' || !row?.timezone?.trim()) return undefined
    return [timezoneOptionFromStored(row.timezone)]
  }, [mode, row])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', type: 'text', label: t('wms.backend.config.warehouses.form.name', 'Name'), required: true },
    { id: 'code', type: 'text', label: t('wms.backend.config.warehouses.form.code', 'Code'), required: true },
    { id: 'city', type: 'text', label: t('wms.backend.config.warehouses.form.city', 'City') },
    {
      id: 'country',
      type: 'combobox',
      label: t('wms.backend.config.warehouses.form.country', 'Country'),
      placeholder: t('wms.backend.config.warehouses.form.countryPlaceholder', 'Search country'),
      loadOptions: (query) => loadCountryOptions(query, locale),
      allowCustomValues: false,
      seedOptions: countrySeedOptions,
      resolveLabel: (value) => countryOptionFromStored(value, locale).label,
    },
    {
      id: 'timezone',
      type: 'combobox',
      label: t('wms.backend.config.warehouses.form.timezone', 'Timezone'),
      placeholder: t('wms.backend.config.warehouses.form.timezonePlaceholder', 'Search timezone'),
      loadOptions: loadTimezoneOptions,
      allowCustomValues: false,
      seedOptions: timezoneSeedOptions,
    },
    { id: 'isPrimary', type: 'checkbox', label: t('wms.backend.config.warehouses.form.primary', 'Primary warehouse') },
    { id: 'isActive', type: 'checkbox', label: t('wms.backend.config.warehouses.form.active', 'Active') },
  ], [countrySeedOptions, locale, t, timezoneSeedOptions])

  const initialValues = React.useMemo<WarehouseFormValues>(() => {
    if (mode === 'edit' && row) {
      return {
        name: row.name || '',
        code: row.code || '',
        city: row.city || '',
        country: row.country || '',
        timezone: row.timezone || '',
        isActive: row.is_active !== false,
        isPrimary: row.is_primary === true,
        ...extractCustomFieldEntries(row as Record<string, unknown>),
      } as WarehouseFormValues
    }
    return {
      name: '',
      code: '',
      city: '',
      country: '',
      timezone: '',
      isActive: true,
      isPrimary: false,
    }
  }, [mode, row])

  const handleSubmit = React.useCallback(async (values: WarehouseFormValues) => {
    setSubmitting(true)
    try {
      const payload = mode === 'edit' && row ? { id: row.id, ...values } : values
      const call = await runMutation({
        operation: async () => {
          const result = await apiCall<{ id?: string | null; updatedAt?: string | null; updated_at?: string | null }>(
            '/api/wms/warehouses',
            {
              method: mode === 'edit' ? 'PUT' : 'POST',
              headers: { 'x-om-forbidden-redirect': '0' },
              body: JSON.stringify(payload),
            },
          )
          if (!result.ok) {
            await raiseCrudError(result.response, t('wms.backend.config.warehouses.errors.save', 'Failed to save warehouse.'))
          }
          return result
        },
        context: {},
        mutationPayload: payload,
      })
      flash(
        mode === 'edit'
          ? t('wms.backend.config.warehouses.flash.updated', 'Warehouse updated')
          : t('wms.backend.config.warehouses.flash.created', 'Warehouse created'),
        'success',
      )
      const resultBody =
        call?.result && typeof call.result === 'object'
          ? (call.result as { id?: unknown; updatedAt?: unknown; updated_at?: unknown })
          : null
      const createdId =
        mode === 'create' && typeof resultBody?.id === 'string'
          ? resultBody.id.trim()
          : undefined
      const updatedAt =
        (typeof resultBody?.updatedAt === 'string' && resultBody.updatedAt.trim()) ||
        (typeof resultBody?.updated_at === 'string' && resultBody.updated_at.trim()) ||
        undefined
      onOpenChange(false)
      await onSaved?.({
        mode,
        id: createdId || row?.id,
        values,
        updatedAt: updatedAt || null,
      })
    } catch (error) {
      flashMutationError(error, t('wms.backend.config.warehouses.errors.save', 'Failed to save warehouse.'), t)
    } finally {
      setSubmitting(false)
    }
  }, [mode, onOpenChange, onSaved, row, runMutation, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit'
              ? t('wms.backend.config.warehouses.dialog.edit', 'Edit warehouse')
              : t('wms.backend.config.warehouses.dialog.create', 'Create warehouse')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<WarehouseFormValues>
          schema={warehouseFormSchema}
          fields={fields}
          entityId={E.wms.warehouse}
          initialValues={initialValues}
          submitLabel={t('common.save', 'Save')}
          onSubmit={handleSubmit}
          embedded
          disableInitialFocus
          isLoading={submitting}
          twoColumn
          optimisticLockUpdatedAt={mode === 'edit' ? (row?.updatedAt ?? row?.updated_at ?? null) : undefined}
        />
      </DialogContent>
    </Dialog>
  )
}
