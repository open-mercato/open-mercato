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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Label } from '@open-mercato/ui/primitives/label'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import {
  buildInventoryMutationReferenceId,
  computeCycleCountVariance,
  formatSignedQuantity,
} from '../../lib/inventoryMutationUi'
import {
  fetchBalanceOnHand,
  loadCatalogVariantOptions,
  loadLocationOptions,
  loadWarehouseOptions,
} from './inventoryMutationLoaders'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const cycleCountFormSchema = z.object({
  locationId: z.string().uuid(),
  catalogVariantId: z.string().uuid(),
  countedQuantity: z.coerce.number().min(0),
  reason: z.string().trim().min(1).max(500),
})

type CycleCountFormValues = z.infer<typeof cycleCountFormSchema>

type CycleCountWizardDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
}

type WizardStep = 1 | 2 | 3

export function CycleCountWizardDialog({
  open,
  onOpenChange,
  access,
}: CycleCountWizardDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-cycle-count',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )
  const [step, setStep] = React.useState<WizardStep>(1)
  const [warehouseId, setWarehouseId] = React.useState<string | null>(null)
  const [formKey, setFormKey] = React.useState(0)
  const [draft, setDraft] = React.useState<(CycleCountFormValues & { warehouseId: string }) | null>(null)
  const [systemOnHand, setSystemOnHand] = React.useState(0)
  const [loadingBalance, setLoadingBalance] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [referenceId] = React.useState(() => buildInventoryMutationReferenceId())

  const variance = draft ? computeCycleCountVariance(systemOnHand, draft.countedQuantity) : 0

  const resetWizard = React.useCallback(() => {
    setStep(1)
    setWarehouseId(null)
    setFormKey((key) => key + 1)
    setDraft(null)
    setSystemOnHand(0)
    setLoadingBalance(false)
    setSubmitting(false)
  }, [])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetWizard()
  }, [onOpenChange, resetWizard])

  const initialValues = React.useMemo<CycleCountFormValues>(
    () => ({
      locationId: '',
      catalogVariantId: '',
      countedQuantity: 0,
      reason: 'cycle_count',
    }),
    [],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'locationId',
        type: 'combobox',
        label: t('wms.backend.inventory.cycleCount.form.location', 'Location'),
        required: true,
        loadOptions: (query?: string) => loadLocationOptions(warehouseId ?? '', query),
        allowCustomValues: false,
        disabled: !warehouseId,
      },
      {
        id: 'catalogVariantId',
        type: 'combobox',
        label: t('wms.backend.inventory.cycleCount.form.variant', 'Variant / SKU'),
        required: true,
        loadOptions: loadCatalogVariantOptions,
        allowCustomValues: false,
      },
      {
        id: 'countedQuantity',
        type: 'number',
        label: t('wms.backend.inventory.cycleCount.form.counted', 'Counted quantity'),
        required: true,
        min: 0,
      },
      {
        id: 'reason',
        type: 'textarea',
        label: t('wms.backend.inventory.cycleCount.form.reason', 'Reason'),
        required: true,
      },
    ],
    [t, warehouseId],
  )

  const handleCountSubmit = React.useCallback(
    async (values: CycleCountFormValues) => {
      if (!warehouseId) {
        flash(
          t('wms.backend.inventory.cycleCount.errors.warehouse', 'Select a warehouse first.'),
          'error',
        )
        return
      }
      setLoadingBalance(true)
      try {
        const onHand = await fetchBalanceOnHand({
          warehouseId,
          locationId: values.locationId,
          catalogVariantId: values.catalogVariantId,
        })
        setDraft({ ...values, warehouseId })
        setSystemOnHand(onHand)
        setStep(2)
      } catch (error) {
        console.error('[CycleCountWizardDialog] fetchBalanceOnHand failed', error)
        flash(
          t('wms.backend.inventory.cycleCount.errors.balance', 'Failed to load system on-hand.'),
          'error',
        )
      } finally {
        setLoadingBalance(false)
      }
    },
    [t, warehouseId],
  )

  const handlePost = React.useCallback(async () => {
    if (!draft || !access.scopeReady || !access.organizationId || !access.tenantId || !access.userId) {
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
      const payload = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        warehouseId: draft.warehouseId,
        locationId: draft.locationId,
        catalogVariantId: draft.catalogVariantId,
        countedQuantity: draft.countedQuantity,
        reason: draft.reason,
        referenceId,
        performedBy: access.userId,
      }

      await runMutation({
        operation: async () => {
          const call = await apiCall<{
            ok?: boolean
            adjustmentDelta?: string
            movementId?: string | null
          }>('/api/wms/inventory/cycle-count', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!call.ok) {
            await raiseCrudError(
              call.response,
              t('wms.backend.inventory.cycleCount.errors.submit', 'Failed to post cycle count.'),
            )
          }
          return call.result ?? {}
        },
        context: mutationContext,
        mutationPayload: payload,
      })

      const deltaLabel = formatSignedQuantity(variance)
      flash(
        t('wms.backend.inventory.cycleCount.flash.success', 'Cycle count posted ({delta})', {
          delta: deltaLabel,
        }),
        'success',
      )
      await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
      closeDialog()
    } finally {
      setSubmitting(false)
    }
  }, [
    access,
    closeDialog,
    draft,
    mutationContext,
    queryClient,
    referenceId,
    runMutation,
    t,
    variance,
  ])

  const stepTitle = React.useMemo(() => {
    if (step === 1) {
      return t('wms.backend.inventory.cycleCount.steps.count.title', 'Step 1 — Count')
    }
    if (step === 2) {
      return t('wms.backend.inventory.cycleCount.steps.variance.title', 'Step 2 — Variance')
    }
    return t('wms.backend.inventory.cycleCount.steps.post.title', 'Step 3 — Post')
  }, [step, t])

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if (step === 3 && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!submitting) void handlePost()
      }
    },
    [closeDialog, handlePost, step, submitting],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent className="max-w-lg" onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('wms.backend.inventory.cycleCount.dialog.title', 'Cycle count')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm font-medium text-foreground">{stepTitle}</p>
        {step === 1 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t(
                'wms.backend.inventory.cycleCount.dialog.description',
                'Enter the physical count for a warehouse location. The wizard shows variance before posting.',
              )}
            </p>
            <div className="space-y-2">
              <Label>{t('wms.backend.inventory.cycleCount.form.warehouse', 'Warehouse')}</Label>
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
                placeholder={t(
                  'wms.backend.inventory.cycleCount.form.warehousePlaceholder',
                  'Select warehouse',
                )}
                allowCustomValues={false}
                disabled={loadingBalance}
              />
            </div>
            <CrudForm<CycleCountFormValues>
              key={formKey}
              schema={cycleCountFormSchema}
              fields={fields}
              entityId={E.wms.inventory_movement}
              initialValues={initialValues}
              submitLabel={t('wms.backend.inventory.cycleCount.steps.count.next', 'Review variance')}
              onSubmit={handleCountSubmit}
              embedded
              isLoading={loadingBalance}
              extraActions={(
                <Button type="button" variant="ghost" onClick={closeDialog}>
                  {t('common.cancel', 'Cancel')}
                </Button>
              )}
            />
          </>
        ) : null}
        {step === 2 && draft ? (
          <div className="space-y-4">
            <dl className="grid gap-3 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t('wms.backend.inventory.cycleCount.review.system', 'System on-hand')}
                </dt>
                <dd className="font-medium tabular-nums">{systemOnHand}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t('wms.backend.inventory.cycleCount.review.counted', 'Counted')}
                </dt>
                <dd className="font-medium tabular-nums">{draft.countedQuantity}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-3">
                <dt className="text-muted-foreground">
                  {t('wms.backend.inventory.cycleCount.review.variance', 'Adjustment delta')}
                </dt>
                <dd
                  className={
                    variance === 0
                      ? 'font-medium tabular-nums text-muted-foreground'
                      : variance > 0
                        ? 'font-medium tabular-nums text-status-success-fg'
                        : 'font-medium tabular-nums text-status-warning-fg'
                  }
                >
                  {formatSignedQuantity(variance)}
                </dd>
              </div>
            </dl>
            {variance === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  'wms.backend.inventory.cycleCount.review.noVariance',
                  'Counts match the ledger. Posting will not create a movement.',
                )}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                {t('wms.backend.inventory.cycleCount.steps.back', 'Back')}
              </Button>
              <Button type="button" onClick={() => setStep(3)}>
                {t('wms.backend.inventory.cycleCount.steps.variance.next', 'Continue to post')}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
        {step === 3 && draft ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t(
                'wms.backend.inventory.cycleCount.confirm.description',
                'Confirm to reconcile inventory and append a cycle-count movement when a variance exists.',
              )}
            </p>
            <dl className="grid gap-2 rounded-md border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t('wms.backend.inventory.cycleCount.review.variance', 'Adjustment delta')}
                </dt>
                <dd className="font-medium tabular-nums">{formatSignedQuantity(variance)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t('wms.backend.inventory.cycleCount.form.reason', 'Reason')}
                </dt>
                <dd className="max-w-[60%] text-right font-medium">{draft.reason}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              <span className="inline-flex flex-wrap items-center gap-1">
                {t('wms.backend.inventory.cycleCount.confirm.shortcutPress', 'Press')}
                <KbdShortcut keys={['⌘', 'Enter']} />
                <span>/</span>
                <KbdShortcut keys={['Ctrl', 'Enter']} />
                {t('wms.backend.inventory.cycleCount.confirm.shortcutPost', 'to post.')}
              </span>
            </p>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep(2)} disabled={submitting}>
                {t('wms.backend.inventory.cycleCount.steps.back', 'Back')}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button type="button" onClick={() => void handlePost()} disabled={submitting}>
                  {t('wms.backend.inventory.cycleCount.steps.post.submit', 'Post cycle count')}
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
