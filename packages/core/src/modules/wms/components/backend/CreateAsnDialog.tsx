"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { flashMutationError } from '../../lib/flashMutationError'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  loadCatalogVariantOptions,
  loadStagingLocationOptions,
  loadWarehouseOptions,
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

type CreateAsnDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: WmsInventoryMutationAccess
  onCreated?: (asnId: string) => void
}

type LineDraft = {
  catalogVariantId: string
  expectedQty: number
  targetStagingLocationId: string
}

const formSchema = z.object({
  warehouseId: z.string().uuid(),
  expectedAt: z.string().min(1),
  referenceNumber: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        catalogVariantId: z.string().uuid(),
        expectedQty: z.number().positive(),
        targetStagingLocationId: z.string().uuid().optional(),
      }),
    )
    .min(1),
})

const EMPTY_LINE: LineDraft = {
  catalogVariantId: '',
  expectedQty: 1,
  targetStagingLocationId: '',
}

export function CreateAsnDialog({ open, onOpenChange, access, onCreated }: CreateAsnDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const formRef = React.useRef<HTMLFormElement>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-asn-create',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const [warehouseId, setWarehouseId] = React.useState('')
  const [expectedAt, setExpectedAt] = React.useState('')
  const [referenceNumber, setReferenceNumber] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [lines, setLines] = React.useState<LineDraft[]>([{ ...EMPTY_LINE }])
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [labelCache, setLabelCache] = React.useState<Record<string, string>>({})

  const closeDialog = React.useCallback(() => {
    if (submitting) return
    onOpenChange(false)
  }, [onOpenChange, submitting])

  React.useEffect(() => {
    if (!open) return
    setWarehouseId('')
    setExpectedAt(new Date().toISOString().slice(0, 10))
    setReferenceNumber('')
    setNotes('')
    setLines([{ ...EMPTY_LINE }])
    setFieldErrors({})
    setSubmitting(false)
  }, [open])

  const resolveOptionLabel = React.useCallback(
    async (value: string) => {
      if (labelCache[value]) return labelCache[value]
      const [warehouse, variant, location] = await Promise.all([
        resolveWarehouseLabel(value),
        resolveCatalogVariantLabel(value),
        resolveLocationLabel(value),
      ])
      const label = warehouse || variant || location
      if (label) setLabelCache((prev) => ({ ...prev, [value]: label }))
      return label ?? value
    },
    [labelCache],
  )

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (!access.scopeReady || !access.organizationId || !access.tenantId) {
        flash(
          t(
            'wms.backend.inventory.mutations.errors.scope',
            'Select an organization and sign in before posting inventory changes.',
          ),
          'error',
        )
        return
      }

      const parsed = formSchema.safeParse({
        warehouseId,
        expectedAt,
        referenceNumber: referenceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((line) => ({
          catalogVariantId: line.catalogVariantId,
          expectedQty: line.expectedQty,
          targetStagingLocationId: line.targetStagingLocationId.trim() || undefined,
        })),
      })
      if (!parsed.success) {
        const nextErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.') || 'form'
          if (!nextErrors[key]) {
            nextErrors[key] = t(issue.message, issue.message)
          }
        }
        setFieldErrors(nextErrors)
        return
      }

      setSubmitting(true)
      setFieldErrors({})
      const payload = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        warehouseId: parsed.data.warehouseId,
        expectedAt: parsed.data.expectedAt,
        referenceNumber: parsed.data.referenceNumber ?? null,
        notes: parsed.data.notes ?? null,
        status: 'in_transit' as const,
        lines: parsed.data.lines,
      }

      try {
        const result = await runMutation({
          operation: async () => {
            const call = await apiCall<{ id?: string }>(
              '/api/wms/asns',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
            )
            if (!call.ok) {
              await raiseCrudError(
                call.response,
                t('wms.backend.asns.create.errors.submit', 'Failed to create ASN.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        const asnId = typeof result?.id === 'string' ? result.id : null
        flash(t('wms.backend.asns.create.flash.success', 'ASN created'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-asns-list'] })
        closeDialog()
        if (asnId) onCreated?.(asnId)
      } catch (error) {
        flashMutationError(error, t('wms.backend.asns.create.errors.submit', 'Failed to create ASN.'), t)
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      closeDialog,
      expectedAt,
      lines,
      mutationContext,
      notes,
      onCreated,
      queryClient,
      referenceNumber,
      runMutation,
      t,
      warehouseId,
    ],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!submitting) void handleSubmit()
      }
    },
    [closeDialog, handleSubmit, submitting],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" onKeyDown={handleKeyDown}>
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>{t('wms.backend.asns.create.dialog.title', 'Create ASN')}</DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.asns.create.dialog.description',
                'Create an expected inbound shipment with receiving lines.',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <FormField
              label={t('wms.backend.asns.create.form.warehouse', 'Warehouse')}
              required
              error={fieldErrors.warehouseId}
            >
              <ComboboxInput
                value={warehouseId}
                onChange={setWarehouseId}
                loadSuggestions={async (query) => loadWarehouseOptions(query)}
                resolveLabel={resolveOptionLabel}
                placeholder={t('wms.backend.asns.create.form.warehousePlaceholder', 'Select warehouse')}
                allowCustomValues={false}
                disabled={submitting}
              />
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={t('wms.backend.asns.create.form.expectedAt', 'Expected date')}
                required
                error={fieldErrors.expectedAt}
              >
                <Input
                  type="date"
                  value={expectedAt}
                  onChange={(event) => setExpectedAt(event.target.value)}
                  disabled={submitting}
                />
              </FormField>
              <FormField
                label={t('wms.backend.asns.create.form.referenceNumber', 'Reference')}
                error={fieldErrors.referenceNumber}
              >
                <Input
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  disabled={submitting}
                  placeholder={t('wms.backend.asns.create.form.referencePlaceholder', 'PO / ASN ref')}
                />
              </FormField>
            </div>

            <FormField label={t('wms.backend.asns.create.form.notes', 'Notes')} error={fieldErrors.notes}>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={submitting}
                rows={2}
              />
            </FormField>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  {t('wms.backend.asns.create.form.lines', 'Expected lines')}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}
                >
                  {t('wms.backend.asns.create.form.addLine', 'Add line')}
                </Button>
              </div>
              {lines.map((line, index) => (
                <div key={`line-${index}`} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
                  <FormField
                    label={t('wms.backend.asns.create.form.variant', 'Variant')}
                    required
                    error={fieldErrors[`lines.${index}.catalogVariantId`]}
                    className="sm:col-span-2"
                  >
                    <ComboboxInput
                      value={line.catalogVariantId}
                      onChange={(next) => {
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, catalogVariantId: next.trim() } : item,
                          ),
                        )
                      }}
                      loadSuggestions={async (query) => loadCatalogVariantOptions(query)}
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.asns.create.form.variantPlaceholder',
                        'Search variant or SKU',
                      )}
                      allowCustomValues={false}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField
                    label={t('wms.backend.asns.create.form.expectedQty', 'Expected qty')}
                    required
                    error={fieldErrors[`lines.${index}.expectedQty`]}
                  >
                    <Input
                      type="number"
                      min={0.0001}
                      step="any"
                      value={line.expectedQty}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, expectedQty: Number.isFinite(next) ? next : 0 }
                              : item,
                          ),
                        )
                      }}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField
                    label={t('wms.backend.asns.create.form.staging', 'Staging location')}
                    error={fieldErrors[`lines.${index}.targetStagingLocationId`]}
                    className="sm:col-span-3"
                  >
                    <ComboboxInput
                      value={line.targetStagingLocationId}
                      onChange={(next) => {
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, targetStagingLocationId: next.trim() }
                              : item,
                          ),
                        )
                      }}
                      loadSuggestions={async (query) =>
                        warehouseId ? loadStagingLocationOptions(warehouseId, query) : []
                      }
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.asns.create.form.stagingPlaceholder',
                        'Optional staging/dock',
                      )}
                      allowCustomValues={false}
                      disabled={submitting || !warehouseId}
                    />
                  </FormField>
                </div>
              ))}
              {fieldErrors.lines ? (
                <p className="text-sm text-status-error-text">{fieldErrors.lines}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />{' '}
              {t('wms.backend.asns.create.dialog.shortcutHint', 'to save')}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('wms.backend.asns.create.dialog.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting} data-testid="create-asn-submit">
                {t('wms.backend.asns.create.dialog.submit', 'Create ASN')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
