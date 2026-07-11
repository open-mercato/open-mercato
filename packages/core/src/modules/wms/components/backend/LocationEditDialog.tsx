"use client"

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { flashMutationError } from '../../lib/flashMutationError'
import { loadWarehouseOptions } from './wmsLookupLoaders'

export type LocationDialogRow = {
  id: string
  warehouse_id?: string | null
  code?: string | null
  type?: string | null
  capacity_units?: string | number | null
  capacity_weight?: string | number | null
  is_active?: boolean | null
  updated_at?: string | null
  updatedAt?: string | null
}

export type LocationFormValues = {
  warehouseId: string
  code: string
  type: 'zone' | 'aisle' | 'rack' | 'bin' | 'slot' | 'dock' | 'staging'
  capacityUnits?: number
  capacityWeight?: number
  isActive: boolean
}

export const locationFormSchema = z.object({
  warehouseId: z.string().uuid(),
  code: z.string().trim().min(1),
  type: z.enum(['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging']),
  capacityUnits: z.coerce.number().min(0).optional(),
  capacityWeight: z.coerce.number().min(0).optional(),
  isActive: z.boolean().default(true),
})

type LocationEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  row?: LocationDialogRow | null
  onSaved?: () => void | Promise<void>
}

export function LocationEditDialog({ open, onOpenChange, mode, row, onSaved }: LocationEditDialogProps) {
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'wms-config-locations' })
  const [submitting, setSubmitting] = React.useState(false)

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'warehouseId',
      type: 'combobox',
      label: t('wms.backend.config.locations.form.warehouse', 'Warehouse'),
      required: true,
      loadOptions: loadWarehouseOptions,
      allowCustomValues: false,
    },
    { id: 'code', type: 'text', label: t('wms.backend.config.locations.form.code', 'Code'), required: true },
    {
      id: 'type',
      type: 'select',
      label: t('wms.backend.config.locations.form.type', 'Type'),
      required: true,
      options: [
        { value: 'zone', label: t('wms.backend.config.locations.type.zone', 'Zone') },
        { value: 'aisle', label: t('wms.backend.config.locations.type.aisle', 'Aisle') },
        { value: 'rack', label: t('wms.backend.config.locations.type.rack', 'Rack') },
        { value: 'bin', label: t('wms.backend.config.locations.type.bin', 'Bin') },
        { value: 'slot', label: t('wms.backend.config.locations.type.slot', 'Slot') },
        { value: 'dock', label: t('wms.backend.config.locations.type.dock', 'Dock') },
        { value: 'staging', label: t('wms.backend.config.locations.type.staging', 'Staging') },
      ],
    },
    { id: 'capacityUnits', type: 'number', label: t('wms.backend.config.locations.form.capacityUnits', 'Capacity units') },
    { id: 'capacityWeight', type: 'number', label: t('wms.backend.config.locations.form.capacityWeight', 'Capacity weight') },
    { id: 'isActive', type: 'checkbox', label: t('wms.backend.config.locations.form.active', 'Active') },
  ], [t])

  const initialValues = React.useMemo<LocationFormValues>(() => {
    if (mode === 'edit' && row) {
      return {
        warehouseId: row.warehouse_id || '',
        code: row.code || '',
        type: (row.type as LocationFormValues['type']) || 'bin',
        capacityUnits: row.capacity_units == null ? undefined : Number(row.capacity_units),
        capacityWeight: row.capacity_weight == null ? undefined : Number(row.capacity_weight),
        isActive: row.is_active !== false,
      }
    }
    return {
      warehouseId: '',
      code: '',
      type: 'bin',
      capacityUnits: undefined,
      capacityWeight: undefined,
      isActive: true,
    }
  }, [mode, row])

  const handleSubmit = React.useCallback(async (values: LocationFormValues) => {
    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(
            '/api/wms/locations',
            {
              method: mode === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify(mode === 'edit' && row ? { id: row.id, ...values } : values),
            },
          )
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.locations.errors.save', 'Failed to save location.'))
          }
          return call
        },
        context: {},
        mutationPayload: mode === 'edit' && row ? { id: row.id, ...values } : values,
      })
      flash(
        mode === 'edit'
          ? t('wms.backend.config.locations.flash.updated', 'Location updated')
          : t('wms.backend.config.locations.flash.created', 'Location created'),
        'success',
      )
      onOpenChange(false)
      await onSaved?.()
    } catch (error) {
      flashMutationError(error, t('wms.backend.config.locations.errors.save', 'Failed to save location.'))
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
              ? t('wms.backend.config.locations.dialog.edit', 'Edit location')
              : t('wms.backend.config.locations.dialog.create', 'Create location')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<LocationFormValues>
          schema={locationFormSchema}
          fields={fields}
          entityId={E.wms.warehouse_location}
          initialValues={initialValues}
          submitLabel={t('common.save', 'Save')}
          onSubmit={handleSubmit}
          embedded
          isLoading={submitting}
          twoColumn
          optimisticLockUpdatedAt={mode === 'edit' ? (row?.updatedAt ?? row?.updated_at ?? null) : undefined}
        />
      </DialogContent>
    </Dialog>
  )
}
