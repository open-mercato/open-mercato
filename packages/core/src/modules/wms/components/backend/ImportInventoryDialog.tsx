"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, FileText } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
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
import { Input } from '@open-mercato/ui/primitives/input'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  countMappedColumns,
  detectColumnMappings,
  mapCsvRowsWithMappings,
  parseCsvText,
  type DetectedColumnMapping,
  type InventoryImportRawRow,
} from '../../lib/inventoryImportCsv'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

type ImportAccess = Pick<
  ReturnType<typeof useWmsInventoryMutationAccess>,
  'organizationId' | 'tenantId' | 'userId' | 'scopeReady'
>

type WizardStep = 1 | 2 | 3

type ValidationRow = {
  rowNumber: number
  status: 'valid' | 'error' | 'warning' | 'skip'
  errors: string[]
  warnings: string[]
  resolved?: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
    quantity: number
    delta: number
    lotId?: string
    serialNumber?: string
    sku?: string
    locationCode?: string
    warehouseCode?: string
  }
}

type ValidationResponse = {
  ok?: boolean
  importBatchId?: string
  summary?: {
    totalRows?: number
    validRows?: number
    errorRows?: number
    warningRows?: number
    skipRows?: number
  }
  rows?: ValidationRow[]
}

type ParsedFileMeta = {
  headers: string[]
  rowCount: number
  fileSize: number
}

type ImportInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ImportAccess
}

const TARGET_FIELD_KEYS: Array<keyof InventoryImportRawRow> = [
  'warehouseCode',
  'locationCode',
  'sku',
  'quantity',
  'lotNumber',
  'serialNumber',
]

function ImportStepIndicator({ step }: { step: WizardStep }) {
  const steps = [1, 2, 3] as const

  return (
    <div className="flex items-center gap-1.5 pt-1" aria-label={`Step ${step} of 3`}>
      {steps.map((stepNumber, index) => {
        const completed = stepNumber < step
        const current = stepNumber === step

        return (
          <React.Fragment key={stepNumber}>
            {index > 0 ? (
              <div
                className={cn(
                  'h-0.5 w-4 shrink-0',
                  stepNumber <= step ? 'bg-foreground' : 'bg-border',
                )}
                aria-hidden="true"
              />
            ) : null}
            <div
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                completed || current
                  ? 'bg-foreground text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
              aria-current={current ? 'step' : undefined}
            >
              {completed ? <Check className="size-3" aria-hidden="true" /> : stepNumber}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

function formatRowCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatImportIssue(
  code: string,
  t: ReturnType<typeof useT>,
): string {
  const duplicateMatch = /^duplicate_of_row_(\d+)$/.exec(code)
  if (duplicateMatch) {
    return t(
      'wms.backend.inventory.import.validation.duplicate_of_row',
      'Duplicate of row {row}',
      { row: duplicateMatch[1] },
    )
  }
  return t(`wms.backend.inventory.import.validation.${code}`, code)
}

export function ImportInventoryDialog({ open, onOpenChange, access }: ImportInventoryDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [step, setStep] = React.useState<WizardStep>(1)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [parsedFile, setParsedFile] = React.useState<ParsedFileMeta | null>(null)
  const [columnMappings, setColumnMappings] = React.useState<DetectedColumnMapping[]>([])
  const [validation, setValidation] = React.useState<ValidationResponse | null>(null)
  const [validating, setValidating] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [showIssueDetails, setShowIssueDetails] = React.useState(false)
  const [skipDuplicates, setSkipDuplicates] = React.useState(true)
  const [isDragging, setIsDragging] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'wms-inventory-import' })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const resetState = React.useCallback(() => {
    setStep(1)
    setSelectedFile(null)
    setParsedFile(null)
    setColumnMappings([])
    setValidation(null)
    setValidating(false)
    setApplying(false)
    setShowIssueDetails(false)
    setSkipDuplicates(true)
    setIsDragging(false)
  }, [])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetState()
  }, [onOpenChange, resetState])

  React.useEffect(() => {
    if (!open) resetState()
  }, [open, resetState])

  const targetFieldLabel = React.useCallback(
    (field: keyof InventoryImportRawRow) => {
      const labels: Record<keyof InventoryImportRawRow, string> = {
        warehouseCode: t('wms.backend.inventory.import.mapping.fields.warehouseCode', 'warehouse_code'),
        warehouseId: t('wms.backend.inventory.import.mapping.fields.warehouseId', 'warehouse_id'),
        locationCode: t('wms.backend.inventory.import.mapping.fields.locationCode', 'location_code'),
        locationId: t('wms.backend.inventory.import.mapping.fields.locationId', 'location_id'),
        sku: t('wms.backend.inventory.import.mapping.fields.sku', 'sku'),
        catalogVariantId: t(
          'wms.backend.inventory.import.mapping.fields.catalogVariantId',
          'catalog_variant_id',
        ),
        quantity: t('wms.backend.inventory.import.mapping.fields.quantity', 'quantity'),
        lotNumber: t('wms.backend.inventory.import.mapping.fields.lotNumber', 'lot_number'),
        lotId: t('wms.backend.inventory.import.mapping.fields.lotId', 'lot_id'),
        serialNumber: t('wms.backend.inventory.import.mapping.fields.serialNumber', 'serial_number'),
      }
      return labels[field]
    },
    [t],
  )

  const parseSelectedFile = React.useCallback(async (file: File) => {
    const text = await file.text()
    const parsed = parseCsvText(text)
    const meta: ParsedFileMeta = {
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      fileSize: file.size,
    }
    setParsedFile(meta)
    setColumnMappings(detectColumnMappings(parsed.headers))
    setValidation(null)
  }, [])

  const handleFileSelection = React.useCallback(
    async (file: File | null) => {
      setSelectedFile(file)
      if (!file) {
        setParsedFile(null)
        setColumnMappings([])
        setValidation(null)
        return
      }
      await parseSelectedFile(file)
    },
    [parseSelectedFile],
  )

  const handleDownloadTemplate = React.useCallback(() => {
    const anchor = document.createElement('a')
    anchor.href = '/api/wms/inventory/import/template'
    anchor.download = 'wms-inventory-import-template.csv'
    anchor.click()
  }, [])

  const handleAutoMap = React.useCallback(() => {
    if (!parsedFile) return
    setColumnMappings(detectColumnMappings(parsedFile.headers))
  }, [parsedFile])

  const handleMappingChange = React.useCallback(
    (csvColumn: string, value: string) => {
      setColumnMappings((current) =>
        current.map((mapping) => {
          if (mapping.csvColumn !== csvColumn) return mapping
          if (value === 'skip') {
            return { ...mapping, targetField: null, status: 'skipped' }
          }
          return {
            ...mapping,
            targetField: value as keyof InventoryImportRawRow,
            status: 'mapped',
          }
        }),
      )
      setValidation(null)
    },
    [],
  )

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      const file = event.dataTransfer.files?.[0]
      if (file) void handleFileSelection(file)
    },
    [handleFileSelection],
  )

  const handleValidate = React.useCallback(async () => {
    if (!access.scopeReady || !access.organizationId || !access.tenantId) {
      flash(t('wms.backend.inventory.import.errors.scope', 'Select organization scope before importing.'), 'error')
      return false
    }
    if (!selectedFile) {
      flash(t('wms.backend.inventory.import.errors.file', 'Choose a CSV file first.'), 'error')
      return false
    }

    setValidating(true)
    try {
      const text = await selectedFile.text()
      const parsed = parseCsvText(text)
      const rows = mapCsvRowsWithMappings(parsed.headers, parsed.rows, columnMappings)
      const call = await apiCall<ValidationResponse>('/api/wms/inventory/import/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          skipDuplicates,
          rows,
        }),
      })
      if (!call.ok) {
        await raiseCrudError(
          call.response,
          t('wms.backend.inventory.import.errors.validate', 'Validation failed.'),
        )
      }
      setValidation(call.result ?? null)
      if (call.result?.ok) {
        flash(t('wms.backend.inventory.import.flash.validated', 'CSV validated — review rows before applying.'), 'success')
      } else {
        flash(t('wms.backend.inventory.import.flash.validationErrors', 'Fix validation errors before applying.'), 'error')
      }
      return Boolean(call.result)
    } catch (error) {
      console.error('[ImportInventoryDialog] validate failed', error)
      flash(t('wms.backend.inventory.import.errors.validate', 'Validation failed.'), 'error')
      return false
    } finally {
      setValidating(false)
    }
  }, [access.organizationId, access.scopeReady, access.tenantId, columnMappings, selectedFile, skipDuplicates, t])

  const applyRows = React.useMemo(() => {
    return (validation?.rows ?? [])
      .filter((row) => row.resolved && (row.status === 'valid' || row.status === 'warning' || row.status === 'skip'))
      .map((row) => ({
        rowNumber: row.rowNumber,
        warehouseId: row.resolved!.warehouseId,
        locationId: row.resolved!.locationId,
        catalogVariantId: row.resolved!.catalogVariantId,
        quantity: row.resolved!.quantity,
        delta: row.resolved!.delta,
        lotId: row.resolved!.lotId,
        serialNumber: row.resolved!.serialNumber,
      }))
  }, [validation?.rows])

  const importableRowCount = React.useMemo(() => {
    return applyRows.filter((row) => Math.abs(row.delta) > 0.000001).length
  }, [applyRows])

  const canApply =
    Boolean(validation?.importBatchId) &&
    importableRowCount > 0

  const issueRows = React.useMemo(() => {
    return (validation?.rows ?? []).filter(
      (row) => row.status === 'error' || row.status === 'skip' || row.errors.length > 0,
    )
  }, [validation?.rows])

  const previewRows = React.useMemo(() => {
    return (validation?.rows ?? [])
      .filter((row) => row.resolved && (row.status === 'valid' || row.status === 'warning'))
      .slice(0, 3)
  }, [validation?.rows])

  const mappedColumnCount = countMappedColumns(columnMappings)

  const handleApply = React.useCallback(async () => {
    if (!access.scopeReady || !access.organizationId || !access.tenantId) return
    if (!validation?.importBatchId) return

    const mutationPayload: Record<string, unknown> = {
      organizationId: access.organizationId,
      tenantId: access.tenantId,
      importBatchId: validation.importBatchId,
      rows: applyRows,
    }

    setApplying(true)
    try {
      const result = await runMutation({
        operation: async () => {
          const call = await apiCall<{
            ok?: boolean
            summary?: { applied?: number; skipped?: number; failed?: number }
          }>(
            '/api/wms/inventory/import/apply',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                organizationId: access.organizationId,
                tenantId: access.tenantId,
                importBatchId: validation.importBatchId,
                reason: t('wms.backend.inventory.import.defaultReason', 'CSV import inventory receipt'),
                continueOnError: true,
                rows: applyRows,
              }),
            },
          )
          if (!call.ok) {
            await raiseCrudError(
              call.response,
              t('wms.backend.inventory.import.errors.apply', 'Import failed.'),
            )
          }
          return call.result ?? {}
        },
        context: mutationContext,
        mutationPayload,
      })

      const applied = result?.summary?.applied ?? 0
      const skipped = result?.summary?.skipped ?? 0
      const failed = result?.summary?.failed ?? 0
      if (failed > 0) {
        flash(
          t(
            'wms.backend.inventory.import.flash.appliedPartial',
            'Import finished with errors ({applied} applied, {skipped} skipped, {failed} failed).',
            { applied, skipped, failed },
          ),
          'warning',
        )
      } else {
        flash(
          t('wms.backend.inventory.import.flash.applied', 'Import finished ({applied} applied, {skipped} skipped).', {
            applied,
            skipped,
          }),
          'success',
        )
      }
      await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
      await queryClient.invalidateQueries({ queryKey: ['wms-sku-detail'] })
      closeDialog()
    } catch (error) {
      flash(
        error instanceof Error
          ? error.message
          : t('wms.backend.inventory.import.errors.apply', 'Import failed.'),
        'error',
      )
    } finally {
      setApplying(false)
    }
  }, [
    access.organizationId,
    access.scopeReady,
    access.tenantId,
    applyRows,
    closeDialog,
    queryClient,
    mutationContext,
    runMutation,
    t,
    validation?.importBatchId,
  ])

  const handlePrimaryAction = React.useCallback(async () => {
    if (step === 1) {
      if (!selectedFile) {
        flash(t('wms.backend.inventory.import.errors.file', 'Choose a CSV file first.'), 'error')
        return
      }
      setStep(2)
      return
    }
    if (step === 2) {
      const validated = await handleValidate()
      if (validated) setStep(3)
      return
    }
    await handleApply()
  }, [handleApply, handleValidate, selectedFile, step, t])

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (validating || applying) return
        if (step === 3 && !canApply) return
        void handlePrimaryAction()
      }
    },
    [applying, canApply, closeDialog, handlePrimaryAction, step, validating],
  )

  const stepSubtitle = React.useMemo(() => {
    if (step === 1) {
      return t('wms.backend.inventory.import.steps.upload.subtitle', 'Step 1 of 3 · Upload your file')
    }
    if (step === 2) {
      return t(
        'wms.backend.inventory.import.steps.mapping.subtitle',
        'Step 2 of 3 · Map CSV columns to fields',
      )
    }
    return t('wms.backend.inventory.import.steps.review.subtitle', 'Step 3 of 3 · Review and import')
  }, [step, t])

  const shortcutHint = React.useMemo(() => {
    if (step === 3) {
      return t('wms.backend.inventory.import.shortcut.import', 'to import')
    }
    return t('wms.backend.inventory.import.shortcut.continue', 'continue')
  }, [step, t])

  const primaryDisabled =
    validating ||
    applying ||
    (step === 1 && !selectedFile) ||
    (step === 3 && !canApply)

  const primaryLabel = React.useMemo(() => {
    if (step === 1 || step === 2) {
      return validating
        ? t('wms.backend.inventory.import.actions.validating', 'Validating…')
        : t('wms.backend.inventory.import.actions.next', 'Next')
    }
    return applying
      ? t('wms.backend.inventory.import.actions.applying', 'Importing…')
      : t('wms.backend.inventory.import.actions.importRows', 'Import {count} rows', {
          count: formatRowCount(importableRowCount),
        })
  }, [applying, importableRowCount, step, t, validating])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-2xl gap-0 overflow-hidden p-0"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>{t('wms.backend.inventory.import.dialog.title', 'Import CSV')}</DialogTitle>
            <DialogDescription>{stepSubtitle}</DialogDescription>
            <ImportStepIndicator step={step} />
          </DialogHeader>
        </div>

        <div className="flex max-h-[min(70vh,640px)] flex-col gap-5 overflow-y-auto px-6 py-6">
          {step === 1 ? (
            <>
              <button
                type="button"
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-5 py-8 text-center transition-colors',
                  isDragging
                    ? 'border-border bg-muted/60'
                    : selectedFile
                      ? 'border-border bg-muted/40 hover:bg-muted/60'
                      : 'border-border bg-muted/20 hover:bg-muted/40',
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {selectedFile ? (
                  <>
                    <div className="flex items-center gap-2">
                      <FileText className="size-5 text-foreground" aria-hidden="true" />
                      <p className="text-sm font-semibold text-foreground">{selectedFile.name}</p>
                    </div>
                    {parsedFile ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          'wms.backend.inventory.import.upload.fileMeta',
                          '{rows} rows · {size} · detected',
                          {
                            rows: formatRowCount(parsedFile.rowCount),
                            size: formatFileSize(parsedFile.fileSize),
                          },
                        )}
                      </p>
                    ) : null}
                    <span className="text-xs font-medium text-foreground">
                      {t('wms.backend.inventory.import.actions.chooseDifferent', 'Choose different file')}
                    </span>
                  </>
                ) : (
                  <>
                    <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">
                      {t('wms.backend.inventory.import.upload.dropzoneEmpty', 'Choose CSV file or drop here')}
                    </p>
                  </>
                )}
              </button>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  void handleFileSelection(event.target.files?.[0] ?? null)
                }}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">
                    {t('wms.backend.inventory.import.upload.format', 'Format')}
                  </p>
                  <Select value="csv-comma" disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv-comma">
                        {t(
                          'wms.backend.inventory.import.upload.formatValue',
                          'CSV · comma-separated',
                        )}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">
                    {t('wms.backend.inventory.import.upload.encoding', 'Encoding')}
                  </p>
                  <Select value="utf8" disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utf8">
                        {t(
                          'wms.backend.inventory.import.upload.encodingValue',
                          'UTF-8 (auto-detected)',
                        )}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-start">
                  <Button type="button" variant="outline" onClick={() => void handleDownloadTemplate()}>
                    {t('wms.backend.inventory.import.actions.template', 'Download template')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'wms.backend.inventory.import.upload.skuHint',
                    'The sku column must match an existing catalog product variant in your organization. Warehouse and location codes must already exist in WMS.',
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'wms.backend.inventory.import.upload.quantityHint',
                    'The quantity column is added to whatever stock already exists at that warehouse/location — it is not a target balance.',
                  )}
                </p>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
                <p>
                  {t(
                    'wms.backend.inventory.import.mapping.summary',
                    '{mapped} of {total} columns mapped · {rows} rows detected',
                    {
                      mapped: mappedColumnCount,
                      total: columnMappings.length,
                      rows: formatRowCount(parsedFile?.rowCount ?? 0),
                    },
                  )}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-1 py-0 text-xs font-medium"
                  onClick={handleAutoMap}
                >
                  {t('wms.backend.inventory.import.actions.autoMap', 'Auto-map')}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              </div>

              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{t('wms.backend.inventory.import.mapping.csvColumn', 'CSV column')}</span>
                  <span aria-hidden="true" />
                  <span>{t('wms.backend.inventory.import.mapping.targetField', 'Target field')}</span>
                  <span className="text-right">
                    {t('wms.backend.inventory.import.mapping.status', 'Status')}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {columnMappings.map((mapping) => (
                  <div
                    key={mapping.csvColumn}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 py-2.5"
                  >
                    <p className="truncate text-sm font-semibold text-foreground">{mapping.csvColumn}</p>
                    <span className="text-sm text-muted-foreground" aria-hidden="true">
                      →
                    </span>
                    <Select
                      value={mapping.targetField ?? 'skip'}
                      onValueChange={(value) => handleMappingChange(mapping.csvColumn, value)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_FIELD_KEYS.map((field) => (
                          <SelectItem key={field} value={field}>
                            {targetFieldLabel(field)}
                          </SelectItem>
                        ))}
                        <SelectItem value="skip">
                          {t('wms.backend.inventory.import.mapping.skipColumn', '— skip column')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex justify-end">
                      <StatusBadge variant={mapping.status === 'mapped' ? 'success' : 'neutral'}>
                        {mapping.status === 'mapped'
                          ? t('wms.backend.inventory.import.mapping.status.mapped', 'Mapped')
                          : t('wms.backend.inventory.import.mapping.status.skipped', 'Skipped')}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-start gap-3 rounded-lg border px-3 py-3">
                <Switch checked={skipDuplicates} onCheckedChange={setSkipDuplicates} />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">
                    {t('wms.backend.inventory.import.review.skipDuplicates', 'Skip duplicates')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'wms.backend.inventory.import.review.skipDuplicatesHint',
                      'Duplicate rows in the CSV file will be skipped instead of failing validation',
                    )}
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {step === 3 && validation ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border px-3.5 py-3">
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {formatRowCount(importableRowCount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('wms.backend.inventory.import.review.stats.rows', 'Rows to import')}
                  </p>
                </div>
                <div className="rounded-lg border px-3.5 py-3">
                  <p className="text-2xl font-bold tabular-nums text-status-success-icon">
                    {mappedColumnCount}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('wms.backend.inventory.import.review.stats.columns', 'Columns mapped')}
                  </p>
                </div>
                <div className="rounded-lg border px-3.5 py-3">
                  <p className="text-2xl font-bold tabular-nums text-status-warning-icon">
                    {issueRows.length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('wms.backend.inventory.import.review.stats.issues', 'Validation issues')}
                  </p>
                </div>
              </div>

              {issueRows.length > 0 ? (
                <div className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-status-warning-text">
                        {t(
                          'wms.backend.inventory.import.review.banner.title',
                          '{count} rows will be skipped on import',
                          { count: issueRows.length },
                        )}
                      </p>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {(showIssueDetails ? issueRows : issueRows.slice(0, 2)).map((row) => (
                          <p key={row.rowNumber}>
                            {t(
                              'wms.backend.inventory.import.review.banner.rowIssue',
                              'Row {row}: {issue}',
                              {
                                row: row.rowNumber,
                                issue: [...row.errors, ...row.warnings].map((code) => formatImportIssue(code, t)).join(', ') || row.status,
                              },
                            )}
                          </p>
                        ))}
                      </div>
                    </div>
                    {issueRows.length > 2 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto shrink-0 px-1 py-0 text-xs font-medium text-status-warning-text hover:text-status-warning-text"
                        onClick={() => setShowIssueDetails((current) => !current)}
                      >
                        {showIssueDetails
                          ? t('wms.backend.inventory.import.actions.hideDetails', 'Hide details')
                          : t('wms.backend.inventory.import.actions.viewDetails', 'View details →')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('wms.backend.inventory.import.review.preview.title', 'Preview · first 3 rows')}
                </p>
                <div className="overflow-hidden rounded-lg border">
                  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-3 border-b bg-muted/40 px-3.5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>{t('wms.backend.inventory.import.columns.sku', 'SKU')}</span>
                    <span>{t('wms.backend.inventory.import.columns.location', 'Location')}</span>
                    <span>{t('wms.backend.inventory.import.review.preview.lot', 'Lot')}</span>
                    <span className="text-right">
                      {t('wms.backend.inventory.import.review.preview.qty', 'Qty')}
                    </span>
                  </div>
                  {previewRows.length > 0 ? (
                    previewRows.map((row) => (
                      <div
                        key={row.rowNumber}
                        className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-3 border-b px-3.5 py-2.5 text-xs last:border-b-0"
                      >
                        <span className="truncate font-medium text-foreground">
                          {row.resolved?.sku ?? '—'}
                        </span>
                        <span className="truncate text-foreground">
                          {row.resolved?.locationCode ?? '—'}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {row.resolved?.serialNumber ?? row.resolved?.lotId ?? '—'}
                        </span>
                        <span className="text-right font-semibold tabular-nums text-foreground">
                          {row.resolved?.quantity ?? '—'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="px-3.5 py-4 text-sm text-muted-foreground">
                      {t('wms.backend.inventory.import.review.preview.empty', 'No preview rows available.')}
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
            <KbdShortcut keys={['⌘', 'Enter']} />
            <span>/</span>
            <KbdShortcut keys={['Ctrl', 'Enter']} />
            <span>{shortcutHint}</span>
          </p>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            {step === 1 ? (
              <Button type="button" variant="outline" onClick={closeDialog} disabled={validating || applying}>
                {t('wms.backend.inventory.import.actions.cancel', 'Cancel')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
                disabled={validating || applying}
              >
                {t('wms.backend.inventory.import.actions.back', 'Back')}
              </Button>
            )}
            <Button
              type="button"
              disabled={primaryDisabled}
              onClick={() => void handlePrimaryAction()}
            >
              {primaryLabel}
              {step !== 3 ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
