"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Label } from '@open-mercato/ui/primitives/label'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { buildInventoryMutationReferenceId } from '../../lib/inventoryMutationUi'
import {
  loadCatalogVariantOptions,
  loadLocationOptions,
  loadWarehouseOptions,
} from './inventoryMutationLoaders'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

type AdjustFormValues = {
  locationId: string
  catalogVariantId: string
  delta: number
  reason: string
  serialNumber?: string
}

type AdjustInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
}

export function AdjustInventoryDialog({
  open,
  onOpenChange,
  access,
}: AdjustInventoryDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-adjust',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )
  const adjustFormSchema = React.useMemo(
    () =>
      z.object({
        locationId: z.string().uuid(),
        catalogVariantId: z.string().uuid(),
        delta: z.coerce.number().refine((value) => value !== 0, {
          message: t(
            'wms.backend.inventory.adjust.errors.deltaZero',
            'Inventory delta must be non-zero.',
          ),
        }),
        reason: z.string().trim().min(1).max(500),
        serialNumber: z.string().trim().max(120).optional(),
      }),
    [t],
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [warehouseId, setWarehouseId] = React.useState<string | null>(null)
  const [formKey, setFormKey] = React.useState(0)

  const initialValues = React.useMemo<AdjustFormValues>(
    () => ({
      locationId: '',
      catalogVariantId: '',
      delta: 1,
      reason: '',
      serialNumber: '',
    }),
    [],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'locationId',
        type: 'combobox',
        label: t('wms.backend.inventory.adjust.form.location', 'Location'),
        required: true,
        loadOptions: (query?: string) => loadLocationOptions(warehouseId ?? '', query),
        allowCustomValues: false,
        disabled: !warehouseId,
      },
      {
        id: 'catalogVariantId',
        type: 'combobox',
        label: t('wms.backend.inventory.adjust.form.variant', 'Variant / SKU'),
        required: true,
        loadOptions: loadCatalogVariantOptions,
        allowCustomValues: false,
      },
      {
        id: 'delta',
        type: 'number',
        label: t('wms.backend.inventory.adjust.form.delta', 'Quantity change'),
        required: true,
        description: t(
          'wms.backend.inventory.adjust.form.deltaHelp',
          'Positive adds stock, negative removes stock. Cannot be zero.',
        ),
      },
      {
        id: 'reason',
        type: 'textarea',
        label: t('wms.backend.inventory.adjust.form.reason', 'Reason'),
        required: true,
      },
      {
        id: 'serialNumber',
        type: 'text',
        label: t('wms.backend.inventory.adjust.form.serial', 'Serial number'),
        description: t(
          'wms.backend.inventory.adjust.form.serialHelp',
          'Optional. Use when the variant profile tracks serials.',
        ),
      },
    ],
    [t, warehouseId],
  )

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    setSubmitting(false)
    setWarehouseId(null)
    setFormKey((key) => key + 1)
  }, [onOpenChange])

  const handleSubmit = React.useCallback(
    async (values: AdjustFormValues) => {
      if (!warehouseId) {
        flash(
          t('wms.backend.inventory.adjust.errors.warehouse', 'Select a warehouse first.'),
          'error',
        )
        return
      }
      if (!access.scopeReady || !access.organizationId || !access.tenantId || !access.userId) {
        flash(
          t(
            'wms.backend.inventory.mutations.errors.scope',
            'Select an organization and sign in before posting inventory changes.',
          ),
          'error',
        )
        return
      }

      setSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          warehouseId,
          locationId: values.locationId,
          catalogVariantId: values.catalogVariantId,
          delta: values.delta,
          reason: values.reason,
          referenceType: 'manual',
          referenceId: buildInventoryMutationReferenceId(),
          performedBy: access.userId,
        }
        const serial = values.serialNumber?.trim()
        if (serial) payload.serialNumber = serial

        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean; movementId?: string }>(
              '/api/wms/inventory/adjust',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
            )
            if (!call.ok) {
              await raiseCrudError(
                call.response,
                t('wms.backend.inventory.adjust.errors.submit', 'Failed to adjust inventory.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        flash(t('wms.backend.inventory.adjust.flash.success', 'Inventory adjusted'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
        closeDialog()
      } finally {
        setSubmitting(false)
      }
    },
    [access, closeDialog, mutationContext, queryClient, runMutation, t, warehouseId],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeDialog()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('wms.backend.inventory.adjust.dialog.title', 'Adjust inventory')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t(
            'wms.backend.inventory.adjust.dialog.description',
            'Post opening balances or day-to-day corrections. Changes append to the movement ledger.',
          )}
        </p>
        <div className="space-y-2">
          <Label>{t('wms.backend.inventory.adjust.form.warehouse', 'Warehouse')}</Label>
          <ComboboxInput
            value={warehouseId ?? ''}
            onChange={(next) => {
              setWarehouseId(next.trim() ? next : null)
              setFormKey((key) => key + 1)
            }}
            loadSuggestions={async (query) => {
              const options = await loadWarehouseOptions(query)
              return options.map((option) => ({ value: option.value, label: option.label }))
            }}
            placeholder={t('wms.backend.inventory.adjust.form.warehousePlaceholder', 'Select warehouse')}
            allowCustomValues={false}
            disabled={submitting}
          />
        </div>
        <CrudForm<AdjustFormValues>
          key={formKey}
          schema={adjustFormSchema}
          fields={fields}
          entityId={E.wms.inventory_movement}
          initialValues={initialValues}
          submitLabel={t('wms.backend.inventory.adjust.dialog.submit', 'Post adjustment')}
          onSubmit={handleSubmit}
          embedded
          isLoading={submitting}
          extraActions={(
            <Button type="button" variant="ghost" onClick={closeDialog}>
              {t('common.cancel', 'Cancel')}
            </Button>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
